import { API_ENGINE, ENGINE_IDS, engines } from "./engines/index.mjs";
import { JobError, runJob } from "./job.mjs";
import { runLockdownTest } from "./lockdown.mjs";
import { log } from "./log.mjs";
import { createProbes } from "./probes.mjs";
import { createQueue } from "./queue.mjs";
import { createStore } from "./store.mjs";

const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,79}$/;
const CHECK_LABELS = {
  read: "files",
  command: "commands",
  web: "the web",
  tools: "tools",
};
const FAILURE_MESSAGES = {
  not_installed: "This CLI isn't installed on the server.",
  not_signed_in: "This CLI isn't signed in on the server.",
  timeout: "The CLI didn't answer in time.",
  output_too_large: "The CLI's reply was too large.",
  malformed_output: "The CLI's reply couldn't be read.",
  engine_failed: "The CLI reported an error.",
  aborted: "The request was cancelled.",
  queue_full: "The engine is busy. Try again soon.",
  queue_timeout: "The engine is busy. Try again soon.",
};

function lockdownOutcome(result, engine) {
  const escaped = Object.entries(result.checks)
    .filter(([, value]) => value === "escaped")
    .map(([key]) => CHECK_LABELS[key]);
  if (escaped.length)
    return {
      state: "failed",
      message: `Blocked: this CLI could reach ${escaped.join(", ")}. A CLI update may have changed its controls. It stays off until a test passes.`,
    };
  if (!result.answered)
    return {
      state: "failed",
      message: `The lockdown test couldn't finish, so this CLI stays off. ${FAILURE_MESSAGES[result.failure] ?? "The CLI gave no usable answer."}`,
    };
  return {
    state: "passed",
    message: `Lockdown test passed. ${engine.lockEvidence}`,
  };
}

const engineById = (id) => (Object.hasOwn(engines, id) ? engines[id] : null);

export function createEngineService(config) {
  const store = createStore(config.stateFile);
  const queue = createQueue({
    limit: config.queueLimit,
    waitMs: config.queueWaitMs,
  });
  const lockdowns = new Map();
  const running = new Map();
  const { resolveBinary, getProbe } = createProbes(config);

  function startLockdown(engineId, model) {
    const existing = running.get(engineId);
    if (existing) return existing;
    const engine = engines[engineId];
    const task = (async () => {
      const probe = await getProbe(engine, { fresh: true });
      const binary = await resolveBinary(engine);
      // Not kept, so the engine can run its test as soon as it is installed.
      if (!binary)
        return {
          state: "failed",
          message: FAILURE_MESSAGES.not_installed,
          checks: null,
        };
      const result = await queue.run(() =>
        runLockdownTest(({ prompt, schema }) =>
          runJob(
            {
              engine,
              binary: binary.path,
              model,
              prompt,
              schema,
              timeoutMs: config.lockdownTimeoutMs,
              isLockdownTest: true,
            },
            config,
          ),
        ),
      );
      const outcome = lockdownOutcome(result, engine);
      const record = {
        ...outcome,
        checkedAt: Date.now(),
        signature: binary.signature,
        model,
        version: probe?.version ?? null,
        checks: result.checks,
      };
      lockdowns.set(engineId, record);
      log("lockdown.finished", {
        engine: engineId,
        state: record.state,
        failure: result.failure,
        checks: result.checks,
        tools: result.tools,
        lockProblems: result.lockProblems,
      });
      return record;
    })()
      .catch((error) => {
        const record = {
          state: "failed",
          message:
            `The lockdown test couldn't finish, so this CLI stays off. ${FAILURE_MESSAGES[error.code] ?? ""}`.trim(),
          checkedAt: Date.now(),
          signature: null,
          version: null,
          checks: null,
        };
        lockdowns.set(engineId, record);
        return record;
      })
      .finally(() => running.delete(engineId));
    running.set(engineId, task);
    return task;
  }

  /** A pass counts only for the exact binary and model it ran against. */
  async function lockdownIsCurrent(engine, model) {
    const record = lockdowns.get(engine.id);
    if (record?.state !== "passed" || record.model !== model) return false;
    const binary = await resolveBinary(engine);
    return binary?.signature === record.signature;
  }

  function modelFor(state, engineId) {
    return state.engine === engineId && state.model
      ? state.model
      : engines[engineId].defaultModel;
  }

  async function describeEngine(engine, state) {
    const probe = await getProbe(engine);
    const record = lockdowns.get(engine.id);
    const current = await lockdownIsCurrent(engine, modelFor(state, engine.id));
    const knownGood = probe?.version
      ? engine.knownGoodVersions.includes(probe.version)
      : false;
    return {
      label: engine.label,
      installed: probe?.installed ?? false,
      version: probe?.version ?? null,
      knownGood,
      versionWarning:
        probe?.version && !knownGood
          ? `Version ${probe.version} hasn't been checked. Known good: ${engine.knownGoodVersions.join(", ")}. The lockdown test still decides whether it runs.`
          : null,
      verified: engine.verified,
      signedIn: probe?.signedIn ?? false,
      defaultModel: engine.defaultModel,
      models: probe?.models ?? engine.fallbackModels,
      lockdown: {
        state: running.has(engine.id)
          ? "running"
          : record
            ? record.state === "passed" && !current
              ? "stale"
              : record.state
            : "not_run",
        checkedAt: record?.checkedAt ?? null,
        checks: record?.checks ?? null,
        message: running.has(engine.id)
          ? "The lockdown test is running."
          : record?.state === "passed" && !current
            ? "The CLI or its model changed since the last test, so it must pass again."
            : (record?.message ?? "No lockdown test has run yet."),
      },
    };
  }

  async function status() {
    const state = await store.read();
    const entries = await Promise.all(
      Object.values(engines).map(async (engine) => [
        engine.id,
        await describeEngine(engine, state),
      ]),
    );
    const details = Object.fromEntries(entries);
    if (state.engine === API_ENGINE)
      return {
        engine: API_ENGINE,
        model: null,
        usable: true,
        message: null,
        queue: queue.stats(),
        engines: details,
      };
    const engine = engineById(state.engine);
    if (!engine)
      return {
        engine: state.engine,
        model: state.model,
        usable: false,
        message: "The saved engine couldn't be read. Choose one again.",
        queue: queue.stats(),
        engines: details,
      };
    const usable = await lockdownIsCurrent(
      engine,
      modelFor(state, state.engine),
    );
    const lockdown = details[state.engine].lockdown;
    if (!usable && ["stale", "not_run"].includes(lockdown.state))
      void startLockdown(state.engine, modelFor(state, state.engine));
    return {
      engine: state.engine,
      model: modelFor(state, state.engine),
      usable,
      message: usable ? null : lockdown.message,
      queue: queue.stats(),
      engines: details,
    };
  }

  async function listModels(engineId) {
    const engine = engineById(engineId);
    if (!engine) return null;
    const probe = await getProbe(engine);
    return {
      engine: engineId,
      defaultModel: engine.defaultModel,
      models: probe?.models ?? engine.fallbackModels,
    };
  }

  async function setEngine(engineId, requestedModel) {
    if (!ENGINE_IDS.includes(engineId)) throw new JobError("bad_engine");
    if (engineId === API_ENGINE) {
      if (requestedModel) throw new JobError("bad_model");
      await store.write({ engine: API_ENGINE, model: null });
      return status();
    }
    const engine = engines[engineId];
    const model = requestedModel || engine.defaultModel;
    const probe = await getProbe(engine);
    const allowed = new Set([
      ...engine.fallbackModels,
      ...(probe?.models ?? []),
    ]);
    if (!SAFE_MODEL.test(model) || !allowed.has(model))
      throw new JobError("bad_model");
    await store.write({ engine: engineId, model });
    return status();
  }

  /** Runs the lockdown test now, even if an earlier one passed. */
  async function test(requestedEngine) {
    const state = await store.read();
    const engineId = requestedEngine || state.engine;
    if (!ENGINE_IDS.includes(engineId)) throw new JobError("bad_engine");
    if (engineId === API_ENGINE)
      return {
        engine: API_ENGINE,
        passed: true,
        message: "API key mode doesn't use a CLI, so there is nothing to test.",
        checks: null,
      };
    const started = Date.now();
    lockdowns.delete(engineId);
    const record = await startLockdown(engineId, modelFor(state, engineId));
    return {
      engine: engineId,
      model: modelFor(state, engineId),
      passed: record.state === "passed",
      message: record.message,
      checks: record.checks,
      durationMs: Date.now() - started,
    };
  }

  /** Runs a test first if one is due. Throws if the engine has to stay off. */
  async function passGate(state) {
    if (state.engine === API_ENGINE) throw new JobError("engine_is_api");
    const engine = engineById(state.engine);
    if (!engine) throw new JobError("engine_blocked");
    const model = modelFor(state, state.engine);
    const binary = await resolveBinary(engine);
    if (!binary) throw new JobError("not_installed");
    if (await lockdownIsCurrent(engine, model)) return;
    // A failed test holds until someone presses Test or the binary changes,
    // so a blocked engine doesn't spend quota on every request.
    const earlier = lockdowns.get(engine.id);
    if (
      earlier?.state === "failed" &&
      [null, binary.signature].includes(earlier.signature)
    )
      throw new JobError("engine_blocked");
    const record = await startLockdown(state.engine, model);
    if (record.state !== "passed") throw new JobError("engine_blocked");
  }

  async function generate({ prompt, schema, timeoutMs }, signal) {
    await passGate(await store.read());
    const started = Date.now();
    const run = await queue.run(async () => {
      // The choice, the binary and the verdict can all change during the wait,
      // so what runs is decided here, right before the CLI starts.
      const state = await store.read();
      if (state.engine === API_ENGINE) throw new JobError("engine_is_api");
      const engine = engineById(state.engine);
      if (!engine) throw new JobError("engine_blocked");
      const model = modelFor(state, state.engine);
      const binary = await resolveBinary(engine);
      if (!binary) throw new JobError("not_installed");
      if (!(await lockdownIsCurrent(engine, model)))
        throw new JobError("engine_blocked");
      const job = await runJob(
        {
          engine,
          binary: binary.path,
          model,
          prompt,
          schema,
          timeoutMs: Math.min(
            timeoutMs ?? config.jobTimeoutMs,
            config.jobTimeoutMs,
          ),
          signal,
        },
        config,
      );
      log("job.finished", {
        engine: engine.id,
        ms: Date.now() - started,
        failure: job.failure,
        tools: job.tools,
        lockProblems: job.lockProblems,
      });
      // A locked engine never reports a tool. If one does, nothing it wrote can
      // be trusted and the engine stays off until a test passes. This is set
      // before the queue moves on, so the next job sees it.
      if (job.tools.length || job.lockProblems.length)
        lockdowns.set(engine.id, {
          state: "failed",
          message:
            "Blocked: this CLI used a tool during real work. It stays off until a test passes.",
          checkedAt: Date.now(),
          signature: binary.signature,
          model,
          version: null,
          checks: {
            read: "blocked",
            command: "blocked",
            web: "blocked",
            tools: "escaped",
          },
        });
      return { engine, model, job };
    }, signal);
    const { engine, model, job } = run;
    if (job.tools.length || job.lockProblems.length)
      throw new JobError("lockdown_violation");
    if (job.failure) throw new JobError(job.failure);
    if (schema && (typeof job.structured !== "object" || !job.structured))
      throw new JobError("malformed_output");
    if (!schema && !job.text) throw new JobError("malformed_output");
    return {
      engine: engine.id,
      model,
      text: schema ? JSON.stringify(job.structured) : job.text,
      structured: schema ? job.structured : null,
      usage: job.usage,
      durationMs: Date.now() - started,
      billing: "included_in_subscription",
    };
  }

  /** At start, only the chosen engine is tested. A test can use real quota. */
  async function startUp() {
    const state = await store.read();
    if (engineById(state.engine))
      void startLockdown(state.engine, modelFor(state, state.engine));
  }

  return { status, listModels, setEngine, test, generate, startUp };
}
