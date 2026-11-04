import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnvironment, runCli } from "./runner.mjs";

const NOT_SIGNED_IN =
  /not (logged|signed) in|please (log|sign) ?in|sign in|log ?in required|login required|unauthenticated|run .*login|authentication (failed|required)/i;

export class JobError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function failureFor(run, parsed) {
  if (run.outcome === "timeout") return "timeout";
  if (run.outcome === "overflow") return "output_too_large";
  if (run.outcome === "aborted") return "aborted";
  if (run.outcome === "missing") return "not_installed";
  if (run.outcome === "spawn_failed") return "engine_failed";
  // Matches the error text only to choose a code. The text itself never leaves
  // this process, because it can quote the prompt.
  const errorText = `${parsed?.errorText ?? ""}\n${run.code === 0 ? "" : run.stderr}`;
  if (parsed?.failure === "timeout") return "timeout";
  if (NOT_SIGNED_IN.test(errorText)) return "not_signed_in";
  if (parsed?.failure) return parsed.failure;
  if (run.code !== 0) return "engine_failed";
  return null;
}

/**
 * Runs one prompt in an empty private folder. The caller decides whether the
 * tools the CLI reports using are allowed.
 */
export async function runJob(
  { engine, binary, model, prompt, schema, timeoutMs, signal, isLockdownTest },
  config,
) {
  const base = await mkdtemp(
    join(tmpdir(), `seo-pilot-ai-${randomBytes(4).toString("hex")}-`),
  );
  const workDir = join(base, "work");
  const privateDir = join(base, "private");
  try {
    await mkdir(workDir, { mode: 0o700 });
    await mkdir(privateDir, { mode: 0o700 });
    const args = await engine.prepare({
      model,
      schema,
      workDir,
      privateDir,
      timeoutMs,
    });
    const run = await runCli({
      binary,
      args,
      stdin: engine.stdin(prompt),
      cwd: workDir,
      env: childEnvironment(config.parentEnv, engine.envNames),
      timeoutMs,
      killGraceMs: config.killGraceMs,
      maxOutputBytes: config.maxOutputBytes,
      signal,
    });
    const parsed =
      run.outcome === "exited"
        ? engine.parse(run.stdout, {
            wantsJson: Boolean(schema),
            isLockdownTest: Boolean(isLockdownTest),
          })
        : null;
    const failure = failureFor(run, parsed);
    return {
      failure,
      tools: parsed?.tools ?? [],
      lockProblems: parsed?.lockProblems ?? [],
      text: parsed?.text ?? "",
      structured: parsed?.structured ?? null,
      usage: parsed?.usage ?? null,
    };
  } finally {
    await rm(base, { recursive: true, force: true }).catch(() => {});
  }
}
