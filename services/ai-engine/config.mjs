import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const MIN_TOKEN_LENGTH = 32;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function positiveInt(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive whole number`);
  return parsed;
}

function binaryPath(value, name) {
  if (!value) return null;
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
}

/** Reads settings from the environment. Refuses to start without a token. */
export function loadConfig(env = process.env) {
  const token = env.AI_ENGINE_TOKEN ?? "";
  if (token.length < MIN_TOKEN_LENGTH)
    throw new Error(
      `AI_ENGINE_TOKEN must be set to at least ${MIN_TOKEN_LENGTH} characters. Create one with: openssl rand -hex 32`,
    );
  const host = env.AI_ENGINE_HOST || "127.0.0.1";
  return {
    host,
    loopback: LOOPBACK_HOSTS.has(host),
    port: positiveInt(env.AI_ENGINE_PORT, 8719, "AI_ENGINE_PORT"),
    token,
    stateFile:
      env.AI_ENGINE_STATE_FILE ||
      join(homedir(), ".seo-pilot-ai-engine", "state.json"),
    maxInputBytes: positiveInt(
      env.AI_ENGINE_MAX_INPUT_BYTES,
      2 * 1024 * 1024,
      "AI_ENGINE_MAX_INPUT_BYTES",
    ),
    maxOutputBytes: positiveInt(
      env.AI_ENGINE_MAX_OUTPUT_BYTES,
      4 * 1024 * 1024,
      "AI_ENGINE_MAX_OUTPUT_BYTES",
    ),
    jobTimeoutMs: positiveInt(
      env.AI_ENGINE_JOB_TIMEOUT_MS,
      180_000,
      "AI_ENGINE_JOB_TIMEOUT_MS",
    ),
    lockdownTimeoutMs: positiveInt(
      env.AI_ENGINE_LOCKDOWN_TIMEOUT_MS,
      120_000,
      "AI_ENGINE_LOCKDOWN_TIMEOUT_MS",
    ),
    killGraceMs: positiveInt(
      env.AI_ENGINE_KILL_GRACE_MS,
      2_000,
      "AI_ENGINE_KILL_GRACE_MS",
    ),
    queueLimit: positiveInt(
      env.AI_ENGINE_QUEUE_LIMIT,
      8,
      "AI_ENGINE_QUEUE_LIMIT",
    ),
    queueWaitMs: positiveInt(
      env.AI_ENGINE_QUEUE_WAIT_MS,
      120_000,
      "AI_ENGINE_QUEUE_WAIT_MS",
    ),
    binaries: {
      agy: binaryPath(env.AI_ENGINE_AGY_PATH, "AI_ENGINE_AGY_PATH"),
      claude: binaryPath(env.AI_ENGINE_CLAUDE_PATH, "AI_ENGINE_CLAUDE_PATH"),
      codex: binaryPath(env.AI_ENGINE_CODEX_PATH, "AI_ENGINE_CODEX_PATH"),
    },
    parentEnv: env,
  };
}
