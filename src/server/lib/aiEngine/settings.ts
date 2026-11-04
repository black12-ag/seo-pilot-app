import { isHostedAuthMode } from "@/lib/auth-mode";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AppError } from "@/server/lib/errors";
import { getOpenRouterAccess } from "@/server/lib/openrouter";
import { getEnvValueSync, getWorkersEnv } from "@/server/lib/runtime-env";
import {
  fetchAiEngineStatus,
  getAiEngineConnection,
  setAiEngineChoice,
  testAiEngineChoice,
  AiEngineError,
  type AiEngineStatus,
} from "./client";

const HOSTED_SUBSCRIPTION_REFUSAL =
  "A paid hosted service serving customers can't use a personal subscription. This installation runs on its API key.";

type Actor = { role: string };

export type AiEngineSettingsView =
  | { state: "hosted" }
  | { state: "not_configured"; apiKeySet: boolean }
  | { state: "unreachable"; apiKeySet: boolean; message: string }
  | { state: "ready"; apiKeySet: boolean; status: AiEngineStatus };

function requireManager(actor: Actor) {
  requireOrgPermission(actor, { integration: ["manage"] });
}

async function loadEnv() {
  return (await getWorkersEnv()) ?? {};
}

async function connectionOrRefuse(env: object) {
  if (isHostedAuthMode(getEnvValueSync(env, "AUTH_MODE")))
    throw new AppError("FORBIDDEN", HOSTED_SUBSCRIPTION_REFUSAL);
  const connection = getAiEngineConnection(env);
  if (!connection)
    throw new AppError(
      "VALIDATION_ERROR",
      "Set AI_ENGINE_URL and AI_ENGINE_TOKEN first.",
    );
  return connection;
}

function asAppError(error: unknown) {
  return error instanceof AiEngineError
    ? new AppError("VALIDATION_ERROR", error.message)
    : error;
}

async function get(actor: Actor): Promise<AiEngineSettingsView> {
  requireManager(actor);
  const env = await loadEnv();
  if (isHostedAuthMode(getEnvValueSync(env, "AUTH_MODE")))
    return { state: "hosted" };
  const apiKeySet = Boolean(getOpenRouterAccess(env));
  const connection = getAiEngineConnection(env);
  if (!connection) return { state: "not_configured", apiKeySet };
  try {
    return {
      state: "ready",
      apiKeySet,
      status: await fetchAiEngineStatus(connection),
    };
  } catch (error) {
    if (!(error instanceof AiEngineError) && !isTimeout(error)) throw error;
    return {
      state: "unreachable",
      apiKeySet,
      message: "The AI engine service isn't reachable.",
    };
  }
}

const isTimeout = (error: unknown) =>
  error instanceof Error &&
  (error.name === "TimeoutError" || error.name === "AbortError");

async function set(
  actor: Actor,
  choice: { engine: string; model: string | null },
) {
  requireManager(actor);
  const connection = await connectionOrRefuse(await loadEnv());
  try {
    return await setAiEngineChoice(connection, choice);
  } catch (error) {
    throw asAppError(error);
  }
}

async function test(actor: Actor, engine: string) {
  requireManager(actor);
  const connection = await connectionOrRefuse(await loadEnv());
  try {
    return await testAiEngineChoice(connection, engine);
  } catch (error) {
    throw asAppError(error);
  }
}

export const AiEngineSettings = { get, set, test } as const;
