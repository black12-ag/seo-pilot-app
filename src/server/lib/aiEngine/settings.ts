import { getAuthMode } from "@/lib/auth-mode";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { AppError } from "@/server/lib/errors";
import { getOpenRouterAccess } from "@/server/lib/openrouter";
import { getEnvValueSync, getWorkersEnv } from "@/server/lib/runtime-env";
import {
  fetchAiEngineStatus,
  getAiEngineConnection,
  getAiEngineSetupProblem,
  refusesAiEngine,
  setAiEngineChoice,
  testAiEngineChoice,
  AiEngineError,
  type AiEngineStatus,
} from "./client";

const HOSTED_SUBSCRIPTION_REFUSAL =
  "A paid hosted service serving customers can't use a personal subscription. This installation runs on its API key.";

type Actor = { role: string; userId: string };

export type AiEngineSettingsView =
  | { state: "hosted" }
  | { state: "not_configured"; apiKeySet: boolean }
  | { state: "unreachable"; apiKeySet: boolean; message: string }
  | { state: "ready"; apiKeySet: boolean; status: AiEngineStatus };

/**
 * The engine serves the whole installation, but a role only covers one
 * organization, and anyone with an account can own their own. With accounts,
 * only the first one, the administrator, can change it.
 */
async function requireManager(actor: Actor, env: object) {
  requireOrgPermission(actor, { integration: ["manage"] });
  if (getAuthMode(getEnvValueSync(env, "AUTH_MODE")) !== "password") return;
  if (!(await AuthRepository.isFirstUser(actor.userId)))
    throw new AppError(
      "FORBIDDEN",
      "Only this installation's administrator can change how AI runs.",
    );
}

async function loadEnv() {
  return (await getWorkersEnv()) ?? {};
}

async function connectionOrRefuse(env: object) {
  if (refusesAiEngine(env))
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
  const env = await loadEnv();
  await requireManager(actor, env);
  if (refusesAiEngine(env)) return { state: "hosted" };
  const apiKeySet = Boolean(getOpenRouterAccess(env));
  const setupProblem = getAiEngineSetupProblem(env);
  if (setupProblem)
    return { state: "unreachable", apiKeySet, message: setupProblem };
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
  const env = await loadEnv();
  await requireManager(actor, env);
  const connection = await connectionOrRefuse(env);
  try {
    return await setAiEngineChoice(connection, choice);
  } catch (error) {
    throw asAppError(error);
  }
}

async function test(actor: Actor, engine: string) {
  const env = await loadEnv();
  await requireManager(actor, env);
  const connection = await connectionOrRefuse(env);
  try {
    return await testAiEngineChoice(connection, engine);
  } catch (error) {
    throw asAppError(error);
  }
}

export const AiEngineSettings = { get, set, test } as const;
