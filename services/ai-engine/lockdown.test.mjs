import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { agy } from "./engines/agy.mjs";
import { claude } from "./engines/claude.mjs";
import { codex } from "./engines/codex.mjs";
import { createProbes } from "./probes.mjs";
import { startFixture, TOKEN } from "./testkit.mjs";

const fixtures = [];
async function fixture(options) {
  const started = await startFixture(options);
  fixtures.push(started);
  return started;
}
after(async () => {
  await Promise.all(fixtures.map((item) => item.close()));
});

const realJobs = async (fx) =>
  (await fx.calls()).filter(
    ({ args }) => args.includes("--agent") && !args.includes("--version"),
  );

async function selectAgyAndPass(fx) {
  const set = await fx.json("POST", "/v1/engine", { engine: "agy" });
  assert.equal(set.status, 200);
  const test = await fx.json("POST", "/v1/test", {});
  assert.equal(test.body.passed, true, test.body.message);
}

describe("lockdown", () => {
  for (const [name, behavior, escaped] of [
    ["a canary read", { readFile: true }, "files"],
    ["a command", { runCommand: true }, "commands"],
    [
      "a public fetch",
      {
        structured: {
          read_value: "",
          command_ran: "",
          local_page: "",
          public_page: `ts=${Math.floor(Date.now() / 1000)}.123`,
        },
      },
      "the web",
    ],
    ["a tool call", { tools: ["search_web"] }, "tools"],
    ["the tool-free agent missing", { agent: null }, "tools"],
    ["the default context loading", { inputTokens: 24_000 }, "tools"],
  ])
    it(`blocks the engine after ${name}`, async () => {
      const fx = await fixture({ behavior: { lockdown: behavior } });
      await fx.json("POST", "/v1/engine", { engine: "agy" });
      const test = await fx.json("POST", "/v1/test", {});
      assert.equal(test.body.passed, false);
      assert.match(test.body.message, new RegExp(escaped));
      const status = await fx.json("GET", "/v1/status");
      assert.equal(status.body.usable, false);
      assert.match(status.body.message, /Blocked/);
      const generate = await fx.json("POST", "/v1/generate", { prompt: "x" });
      assert.equal(generate.status, 409);
      assert.equal(generate.body.error.code, "engine_blocked");
    });

  it("blocks when the test can't finish", async () => {
    const fx = await fixture({
      behavior: { lockdown: { status: "ERROR", error: "x", exitCode: 3 } },
    });
    await fx.json("POST", "/v1/engine", { engine: "agy" });
    const test = await fx.json("POST", "/v1/test", {});
    assert.equal(test.body.passed, false);
    assert.match(test.body.message, /couldn't finish/);
  });

  it("runs the test before the first job, and blocks the job if it fails", async () => {
    const fx = await fixture({ behavior: { lockdown: { runCommand: true } } });
    await fx.json("POST", "/v1/engine", { engine: "agy" });
    const generate = await fx.json("POST", "/v1/generate", {
      prompt: "real work",
    });
    assert.equal(generate.status, 409);
    const jobs = await realJobs(fx);
    assert.ok(jobs.every(({ stdin }) => !stdin.includes("real work")));
  });

  it("requires a new pass when the binary changes", async () => {
    const fx = await fixture({ behavior: { job: { text: "ok" } } });
    await selectAgyAndPass(fx);
    const binary = join(fx.dir, "bin", "agy");
    await writeFile(binary, `${await readFile(binary, "utf8")}\n// updated\n`);
    const before = (await realJobs(fx)).length;
    await fx.setBehavior({
      lockdown: { runCommand: true },
      job: { text: "ok" },
    });
    const generate = await fx.json("POST", "/v1/generate", {
      prompt: "after update",
    });
    assert.equal(generate.status, 409);
    assert.equal((await realJobs(fx)).length, before + 1);
  });

  it("turns the engine off if a tool appears during real work", async () => {
    const fx = await fixture({ behavior: { job: { text: "ok" } } });
    await selectAgyAndPass(fx);
    await fx.setBehavior({ job: { text: "leak", tools: ["run_command"] } });
    const result = await fx.json("POST", "/v1/generate", { prompt: "x" });
    assert.equal(result.status, 502);
    assert.equal(result.body.error.code, "lockdown_violation");
    assert.ok(!JSON.stringify(result.body).includes("leak"));
    assert.equal((await fx.json("GET", "/v1/status")).body.usable, false);
  });

  it("doesn't mistake a long prompt for the default context in real work", async () => {
    const fx = await fixture({ behavior: { job: { text: "ok" } } });
    await selectAgyAndPass(fx);
    await fx.setBehavior({ job: { text: "ok", inputTokens: 60_000 } });
    const result = await fx.json("POST", "/v1/generate", { prompt: "long" });
    assert.equal(result.status, 200);
  });

  it("turns the engine off if the tool-free agent is missing in real work", async () => {
    const fx = await fixture({ behavior: { job: { text: "ok" } } });
    await selectAgyAndPass(fx);
    await fx.setBehavior({ job: { text: "leak", agent: null } });
    const result = await fx.json("POST", "/v1/generate", { prompt: "x" });
    assert.equal(result.body.error.code, "lockdown_violation");
  });

  for (const [name, script] of [
    ["hangs", { earlyTool: "run_command", hang: true }],
    ["floods its output", { earlyTool: "run_command", flood: 100_000 }],
  ])
    it(`turns the engine off if a job uses a tool and then ${name}`, async () => {
      const fx = await fixture({
        env: {
          AI_ENGINE_JOB_TIMEOUT_MS: "800",
          AI_ENGINE_MAX_OUTPUT_BYTES: "4096",
        },
      });
      await selectAgyAndPass(fx);
      await fx.setBehavior({ job: script });
      const result = await fx.json("POST", "/v1/generate", { prompt: "x" });
      assert.equal(result.body.error.code, "lockdown_violation");
      assert.equal((await fx.json("GET", "/v1/status")).body.usable, false);
    });

  it("turns the engine off if a job uses a tool and the caller leaves", async () => {
    const fx = await fixture();
    await selectAgyAndPass(fx);
    await fx.setBehavior({ job: { earlyTool: "run_command", hang: true } });
    const controller = new AbortController();
    const pending = fetch(`${fx.base}/v1/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ prompt: "x" }),
      signal: controller.signal,
    }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 400));
    controller.abort();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal((await fx.json("GET", "/v1/status")).body.usable, false);
  });

  it("doesn't wedge when a helper outside the group holds the pipes", async () => {
    const fx = await fixture();
    await selectAgyAndPass(fx);
    await fx.setBehavior({ job: { helper: true, text: "ok" } });
    const result = await fx.json("POST", "/v1/generate", { prompt: "x" });
    assert.equal(result.body.error.code, "lockdown_violation");
    const status = await fx.json("GET", "/v1/status");
    assert.equal(status.body.queue.running, 0);
    assert.equal(status.body.usable, false);
  });

  describe("while a job waits in the queue", () => {
    async function withWaitingJob(fx, first, change) {
      await selectAgyAndPass(fx);
      await fx.setBehavior({ job: first });
      const running = fx.json("POST", "/v1/generate", { prompt: "first" });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const waiting = fx.json("POST", "/v1/generate", { prompt: "second" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await change?.();
      await running;
      const result = await waiting;
      const ran = (await realJobs(fx)).some(({ stdin }) =>
        stdin.includes("second"),
      );
      return { result, ran };
    }

    it("doesn't run it once an earlier job trips the lock", async () => {
      const fx = await fixture();
      const { result, ran } = await withWaitingJob(fx, {
        tools: ["run_command"],
        delayMs: 500,
      });
      assert.equal(result.body.error.code, "engine_blocked");
      assert.equal(ran, false);
    });

    it("doesn't run it on a binary that was replaced", async () => {
      const fx = await fixture();
      const binary = join(fx.dir, "bin", "agy");
      const { result, ran } = await withWaitingJob(
        fx,
        { text: "ok", delayMs: 500 },
        async () =>
          writeFile(binary, `${await readFile(binary, "utf8")}\n// new\n`),
      );
      assert.equal(result.body.error.code, "engine_blocked");
      assert.equal(ran, false);
    });

    it("doesn't run it after a switch to the API key", async () => {
      const fx = await fixture();
      const { result, ran } = await withWaitingJob(
        fx,
        { text: "ok", delayMs: 500 },
        () => fx.json("POST", "/v1/engine", { engine: "api" }),
      );
      assert.equal(result.body.error.code, "engine_is_api");
      assert.equal(ran, false);
    });
  });

  it("needs a new test when the model changes", async () => {
    const fx = await fixture({ behavior: { job: { text: "ok" } } });
    await selectAgyAndPass(fx);
    const tests = async () =>
      (await realJobs(fx)).filter(({ stdin }) => stdin.includes("Safety check"))
        .length;
    assert.equal(await tests(), 1);
    await fx.json("POST", "/v1/engine", {
      engine: "agy",
      model: "Gemini 3.8 Flash (High)",
    });
    const result = await fx.json("POST", "/v1/generate", { prompt: "x" });
    assert.equal(result.status, 200);
    assert.equal(result.body.model, "Gemini 3.8 Flash (High)");
    assert.equal(await tests(), 2);
  });

  it("blocks a test with no token count, since that's the proof", async () => {
    const fx = await fixture({ behavior: { lockdown: { noTokens: true } } });
    await fx.json("POST", "/v1/engine", { engine: "agy" });
    assert.equal((await fx.json("POST", "/v1/test", {})).body.passed, false);
  });

  it("doesn't tell the model it has no tools during the test", async () => {
    const fx = await fixture({ behavior: { job: { text: "ok" } } });
    await selectAgyAndPass(fx);
    const test = await fx.json("POST", "/v1/test", {});
    assert.match(test.body.message, /tool-free agent/);
    const dir = await mkdtemp(join(tmpdir(), "agent-file-"));
    const agentFile = join(dir, ".agents", "agents", "seo-pilot-text.md");
    await mkdir(dir, { recursive: true });
    await agy.prepare({
      model: "m",
      workDir: dir,
      timeoutMs: 10_000,
      isLockdownTest: true,
    });
    assert.ok(!(await readFile(agentFile, "utf8")).includes("no tools"));
    await agy.prepare({ model: "m", workDir: dir, timeoutMs: 10_000 });
    assert.ok((await readFile(agentFile, "utf8")).includes("no tools"));
    await rm(dir, { recursive: true, force: true });
  });

  it("can run its test as soon as a missing CLI is installed", async () => {
    const fx = await fixture({ behavior: { job: { text: "ok" } } });
    const binary = join(fx.dir, "bin", "agy");
    await rename(binary, `${binary}.away`);
    await fx.json("POST", "/v1/engine", { engine: "agy" });
    const missing = await fx.json("POST", "/v1/test", {});
    assert.equal(missing.body.passed, false);
    await rename(`${binary}.away`, binary);
    const result = await fx.json("POST", "/v1/generate", { prompt: "x" });
    assert.equal(result.status, 200);
  });

  it("warns about an unknown version but lets the test decide", async () => {
    const fx = await fixture({ behavior: { version: "9.9.9" } });
    await selectAgyAndPass(fx);
    const status = await fx.json("GET", "/v1/status");
    assert.match(status.body.engines.agy.versionWarning, /9\.9\.9/);
    assert.equal(status.body.engines.agy.knownGood, false);
    assert.equal(status.body.usable, true);
  });

  it("reports whether the CLI is installed and signed in", async () => {
    const fx = await fixture();
    const status = await fx.json("GET", "/v1/status");
    assert.equal(status.body.engines.agy.installed, true);
    assert.equal(status.body.engines.agy.signedIn, true);
    assert.equal(status.body.engines.claude.installed, false);
    assert.equal(status.body.engines.codex.verified, false);
  });
});

describe("binary signature", () => {
  it("changes when code behind a script's entry file changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "package-stamp-"));
    const entry = join(dir, "bin", "tool.js");
    await mkdir(join(dir, "bin"));
    await writeFile(join(dir, "package.json"), "{}");
    await writeFile(join(dir, "lib.js"), "// one");
    await writeFile(entry, "#!/bin/sh\n", { mode: 0o755 });
    const { resolveBinary } = createProbes({
      binaries: { tool: entry },
      parentEnv: {},
    });
    const engine = { id: "tool", binaryName: "tool.js" };
    const before = (await resolveBinary(engine)).signature;
    assert.equal((await resolveBinary(engine)).signature, before);
    await writeFile(join(dir, "lib.js"), "// the new code is longer");
    assert.notEqual((await resolveBinary(engine)).signature, before);
    await rm(dir, { recursive: true, force: true });
  });
});

const init = (fields) =>
  JSON.stringify({ type: "system", subtype: "init", ...fields });

describe("claude output", () => {
  const result = JSON.stringify({
    type: "result",
    subtype: "success",
    result: "ok",
  });

  it("fails closed when the startup line has no tool list", () => {
    const parsed = claude.parse(`${init({})}\n${result}\n`);
    assert.deepEqual(parsed.lockProblems, ["tool list not reported"]);
    const clean = claude.parse(`${init({ tools: [] })}\n${result}\n`);
    assert.deepEqual(clean.lockProblems, []);
  });

  it("counts every kind of tool use", () => {
    for (const type of ["tool_use", "server_tool_use", "mcp_tool_use"]) {
      const assistant = JSON.stringify({
        type: "assistant",
        message: { content: [{ type, name: "web_search" }] },
      });
      const parsed = claude.parse(
        `${init({ tools: [] })}\n${assistant}\n${result}\n`,
      );
      assert.deepEqual(parsed.tools, ["web_search"], type);
    }
  });

  it("doesn't call a run that was cut short a broken lock by itself", () => {
    assert.deepEqual(claude.parse("", { partial: true }).lockProblems, []);
  });
});

describe("codex output schema", () => {
  it("keeps properties named like schema keywords", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-schema-"));
    const schema = {
      type: "object",
      properties: {
        format: { type: "string", format: "email", minLength: 2 },
        default: { type: "string" },
        required: { type: "string" },
      },
      required: ["format"],
    };
    const args = await codex.prepare({
      model: "m",
      schema,
      privateDir: dir,
      workDir: dir,
    });
    const file = args[args.indexOf("--output-schema") + 1];
    assert.ok(existsSync(file));
    const strict = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(Object.keys(strict.properties), [
      "format",
      "default",
      "required",
    ]);
    assert.deepEqual(strict.required, ["format", "default", "required"]);
    assert.deepEqual(strict.properties.format, { type: "string" });
    await rm(dir, { recursive: true, force: true });
  });
});
