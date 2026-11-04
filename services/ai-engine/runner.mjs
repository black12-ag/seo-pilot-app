import { spawn } from "node:child_process";

const ENV_ALLOWLIST = [
  "HOME",
  "PATH",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TZ",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
];

/**
 * Only what a logged-in CLI needs. API keys are left out on purpose: one set in
 * the service's own environment would silently bill it instead of the login.
 */
export function childEnvironment(parentEnv, extraNames = []) {
  const env = { NO_COLOR: "1" };
  for (const name of [...ENV_ALLOWLIST, ...extraNames])
    if (parentEnv[name]) env[name] = parentEnv[name];
  return env;
}

/**
 * Runs one fixed binary with fixed arguments and no shell. The child leads its
 * own process group, so a timeout also ends anything it started.
 */
export function runCli({
  binary,
  args,
  stdin,
  cwd,
  env,
  timeoutMs,
  killGraceMs,
  maxOutputBytes,
  signal,
}) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd,
      env,
      shell: false,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let outcome = "exited";
    let killTimer;

    const killGroup = (name) => {
      try {
        process.kill(-child.pid, name);
      } catch {
        // The group has already gone.
      }
    };
    const stop = (reason) => {
      if (outcome !== "exited") return;
      outcome = reason;
      killGroup("SIGTERM");
      killTimer = setTimeout(() => killGroup("SIGKILL"), killGraceMs);
    };
    const timeout = setTimeout(() => stop("timeout"), timeoutMs);
    const onAbort = () => stop("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();

    const collect = (sink) => (chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        stop("overflow");
        return;
      }
      sink.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    // A CLI that ignores stdin can close it early; that isn't a failure here.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin ?? "");

    child.on("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        outcome: error.code === "ENOENT" ? "missing" : "spawn_failed",
        code: null,
        stdout: "",
        stderr: "",
      });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      // Something the child started can hold its pipes open past its own exit.
      killGroup("SIGKILL");
      clearTimeout(killTimer);
      resolve({
        outcome,
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
