import { z } from "zod";
import { isHostedAuthMode } from "@/lib/auth-mode";
import { getEnvValueSync } from "@/server/lib/runtime-env";

export type AiEngineConnection = { url: string; token: string };

// The first status after a restart waits for the CLI checks, which can take up
// to 20 seconds, and a timeout here would stop AI.
const STATUS_TIMEOUT_MS = 25_000;
const SETTING_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 180_000;
// Longer than the service's own limits, so it answers with a reason first.
const GENERATE_TIMEOUT_MS = 330_000;

const lockdownSchema = z.object({
  state: z.enum(["passed", "failed", "running", "stale", "not_run"]),
  checkedAt: z.number().nullable(),
  message: z.string(),
  checks: z
    .object({
      read: z.enum(["blocked", "escaped"]),
      command: z.enum(["blocked", "escaped"]),
      web: z.enum(["blocked", "escaped"]),
      tools: z.enum(["blocked", "escaped"]),
    })
    .nullable(),
});

const aiEngineStatusSchema = z.object({
  engine: z.string(),
  model: z.string().nullable(),
  usable: z.boolean(),
  message: z.string().nullable(),
  queue: z.object({ running: z.number(), waiting: z.number() }),
  engines: z.record(
    z.string(),
    z.object({
      label: z.string(),
      installed: z.boolean(),
      version: z.string().nullable(),
      knownGood: z.boolean(),
      versionWarning: z.string().nullable(),
      verified: z.boolean(),
      signedIn: z.boolean(),
      defaultModel: z.string(),
      models: z.array(z.string()),
      lockdown: lockdownSchema,
    }),
  ),
});
export type AiEngineStatus = z.infer<typeof aiEngineStatusSchema>;

const testResultSchema = z.object({
  engine: z.string(),
  passed: z.boolean(),
  message: z.string(),
  checks: lockdownSchema.shape.checks,
});

const generateResultSchema = z.object({
  engine: z.string(),
  model: z.string(),
  text: z.string(),
  structured: z.unknown(),
  usage: z
    .object({
      inputTokens: z.number().nullable(),
      outputTokens: z.number().nullable(),
      cachedInputTokens: z.number().nullable(),
      reasoningTokens: z.number().nullable(),
    })
    .nullable(),
  billing: z.literal("included_in_subscription"),
});
export type AiEngineGenerateResult = z.infer<typeof generateResultSchema>;

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export class AiEngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AiEngineError";
  }
}

/** The hosted service and the Every App gateway never use a personal login. */
export function refusesAiEngine(env: object) {
  const mode = getEnvValueSync(env, "AUTH_MODE");
  return isHostedAuthMode(mode) || mode === "everyapp";
}

/** The service, or null without both settings, or where it's refused. */
export function getAiEngineConnection(env: object): AiEngineConnection | null {
  if (refusesAiEngine(env)) return null;
  const rawUrl = getEnvValueSync(env, "AI_ENGINE_URL");
  const token = getEnvValueSync(env, "AI_ENGINE_TOKEN");
  if (!rawUrl || !token) return null;
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return { url: url.href.replace(/\/+$/, ""), token };
  } catch {
    return null;
  }
}

/**
 * Why the engine settings can't be used, if someone started setting it up. AI
 * then stops, rather than quietly going back to spending the API key.
 */
export function getAiEngineSetupProblem(env: object): string | null {
  if (refusesAiEngine(env) || getAiEngineConnection(env)) return null;
  const partlySet =
    getEnvValueSync(env, "AI_ENGINE_URL") ||
    getEnvValueSync(env, "AI_ENGINE_TOKEN");
  return partlySet
    ? "AI_ENGINE_URL and AI_ENGINE_TOKEN must both be set, and the URL must start with http:// or https://. Fix them, or remove both to use the API key."
    : null;
}

async function request<T>(
  connection: AiEngineConnection,
  path: string,
  init: { body?: unknown; signal: AbortSignal; schema: z.ZodType<T> },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${connection.url}${path}`, {
      method: init.body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${connection.token}`,
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
      // A redirect isn't followed and fails as a bad reply below, so the bearer
      // token only ever reaches the configured service. Workers refuse "error".
      redirect: "manual",
    });
  } catch (error) {
    if (
      init.signal.aborted &&
      error instanceof Error &&
      error.name === "AbortError"
    )
      throw error;
    throw new AiEngineError(
      "unreachable",
      "The AI engine service isn't reachable.",
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(payload);
    throw parsed.success
      ? new AiEngineError(parsed.data.error.code, parsed.data.error.message)
      : new AiEngineError("bad_reply", "The AI engine service gave no answer.");
  }
  const parsed = init.schema.safeParse(payload);
  if (!parsed.success)
    throw new AiEngineError(
      "bad_reply",
      "The AI engine service gave no answer.",
    );
  return parsed.data;
}

export const fetchAiEngineStatus = (connection: AiEngineConnection) =>
  request(connection, "/v1/status", {
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    schema: aiEngineStatusSchema,
  });

export const setAiEngineChoice = (
  connection: AiEngineConnection,
  choice: { engine: string; model: string | null },
) =>
  request(connection, "/v1/engine", {
    body: choice,
    signal: AbortSignal.timeout(SETTING_TIMEOUT_MS),
    schema: aiEngineStatusSchema,
  });

export const testAiEngineChoice = (
  connection: AiEngineConnection,
  engine: string,
) =>
  request(connection, "/v1/test", {
    body: { engine },
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    schema: testResultSchema,
  });

export const generateWithAiEngine = (
  connection: AiEngineConnection,
  input: { prompt: string; schema?: object },
  signal: AbortSignal | undefined,
) =>
  request(connection, "/v1/generate", {
    body: input,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(GENERATE_TIMEOUT_MS)])
      : AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    schema: generateResultSchema,
  });
