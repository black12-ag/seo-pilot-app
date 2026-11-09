import { hasDataforseoAccess } from "@/server/lib/provider-access";
import {
  aiEngineIsOwn,
  type AiEngine,
  type AiOwnEngine,
} from "@/shared/ai-visibility";
import { aiEngineSchema } from "@/types/schemas/ai-visibility";
import { ownAiEngineView } from "../providers/aiEngineEvidence";
import { AiVisibilityError } from "./aiVisibilityErrors";

/**
 * Who can answer now. DataForSEO answers its engines when its key is set. The
 * installation's own AI engine answers "own_ai" when it is set up. Each answer
 * records its engine, so the two never mix in results or trends.
 */
interface AiProviders {
  dataforseo: boolean;
  ownEngine: AiOwnEngine;
}

const DATAFORSEO_ENGINES = aiEngineSchema.options.filter(
  (engine) => !aiEngineIsOwn(engine),
);

export async function loadAiProviders(): Promise<AiProviders> {
  const [dataforseo, ownEngine] = await Promise.all([
    hasDataforseoAccess(),
    ownAiEngineView(),
  ]);
  return { dataforseo, ownEngine };
}

/**
 * The engines offered for tracking, the default first. With no DataForSEO
 * key, the own AI engine replaces its engines. With neither, DataForSEO's
 * engines stay listed so setup still works and says what is missing.
 */
export function offeredAiEngines(providers: AiProviders): AiEngine[] {
  if (!providers.ownEngine.available) return DATAFORSEO_ENGINES;
  return providers.dataforseo ? [...DATAFORSEO_ENGINES, "own_ai"] : ["own_ai"];
}

/** ChatGPT with a DataForSEO key, else the own AI engine when it is set up. */
export async function defaultAiEngine(): Promise<AiEngine> {
  if (await hasDataforseoAccess()) return "chatgpt";
  return (await ownAiEngineView()).available ? "own_ai" : "chatgpt";
}

/**
 * Splits engines into those whose provider can answer now and the rest. A
 * provider is only asked when one of its engines is in the list.
 */
export async function splitReadyAiEngines(engines: AiEngine[]) {
  const [dataforseo, ownEngine] = await Promise.all([
    engines.some((e) => !aiEngineIsOwn(e)) ? hasDataforseoAccess() : false,
    engines.some(aiEngineIsOwn) ? ownAiEngineView() : null,
  ]);
  const ready = (engine: AiEngine) =>
    aiEngineIsOwn(engine) ? Boolean(ownEngine?.available) : dataforseo;
  return {
    ready: engines.filter(ready),
    skipped: engines.filter((engine) => !ready(engine)),
    ownEngineReason: ownEngine?.reason ?? null,
  };
}

/** The engines that can answer now. Throws when none of them can. */
export async function requireReadyAiEngines(
  engines: AiEngine[],
): Promise<AiEngine[]> {
  const { ready, ownEngineReason } = await splitReadyAiEngines(engines);
  if (ready.length || !engines.length) return ready;
  throw new AiVisibilityError(
    "PROVIDER_NOT_CONFIGURED",
    engines.some(aiEngineIsOwn)
      ? `Your AI engine can't answer yet: ${ownEngineReason ?? "it isn't set up."} Your saved tracker remains available.`
      : "An operator must configure DATAFORSEO_API_KEY, or set up your own AI engine and choose it in tracking settings, before collection. Your saved tracker remains available.",
  );
}
