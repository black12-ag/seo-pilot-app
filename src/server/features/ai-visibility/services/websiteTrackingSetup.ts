import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import {
  projectAiConfiguration,
  trackerEngines,
} from "./aiVisibilityConfiguration";
import { normalizeAiSuggestion } from "@/shared/ai-prompt-suggestions";
import { aiEnginesWithoutLocation } from "@/shared/ai-visibility";
import { DEFAULT_LOCATION_CODE } from "@/shared/keyword-locations";
import type { SaveProjectWebsiteSetup } from "@/types/schemas/projectWebsite";
import { AppError } from "@/server/lib/errors";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { startRun } from "./aiVisibilityRuns";
import { defaultAiEngine, splitReadyAiEngines } from "./aiVisibilityProviders";

/** Seeds weekly tracking from website setup's first three suggested topics. */
export async function prepareWebsiteTracking(
  input: Pick<SaveProjectWebsiteSetup, "projectId" | "suggestedTopics">,
  market: { locationCode: number; languageCode: string },
) {
  // Website setup seeds initial tracking only. Existing tracking stays intact,
  // including an enabled schedule, if the website needs setting again.
  if (
    !input.suggestedTopics?.length ||
    (await repo.getConfiguration(input.projectId))
  )
    return null;
  const names = new Set<string>();
  const texts = new Set<string>();
  // ChatGPT with a DataForSEO key, else the own AI engine when it's set up.
  const engine = await defaultAiEngine();
  // The first three topics seed tracking; the rest stay research keywords.
  const prompts = input.suggestedTopics.slice(0, 3).flatMap((topic) => {
    const name = normalizeAiSuggestion(topic.name);
    if (names.has(name))
      throw new AppError(
        "VALIDATION_ERROR",
        "Generated topics must be unique.",
      );
    names.add(name);
    return topic.prompts.map((text) => {
      const normalized = normalizeAiSuggestion(text);
      if (texts.has(normalized))
        throw new AppError(
          "VALIDATION_ERROR",
          "Generated prompts must be unique.",
        );
      texts.add(normalized);
      return { text, topic: topic.name };
    });
  });
  return projectAiConfiguration({
    previous: null,
    projectId: input.projectId,
    projectMarket: aiEnginesWithoutLocation([engine], market.locationCode)
      .length
      ? { locationCode: DEFAULT_LOCATION_CODE, languageCode: "en" }
      : market,
    patch: { engines: [engine], prompts },
    now: new Date().toISOString(),
  }).rows;
}

/**
 * In-app onboarding collects the seeded prompts once, so Prompt Tracking
 * opens on a run in progress rather than an empty tracker. The run is the
 * tracker's baseline; collection checks credits before paid work. Setup is
 * already saved, so a run that cannot start leaves the prompts ready to run.
 */
export async function startWebsiteTrackingRun(
  projectId: string,
  billing: BillingCustomerContext,
) {
  const config = await repo.getConfiguration(projectId);
  if (!config) return;
  // With no provider for its engines there's nothing to run. The prompts stay
  // saved for when one is set up.
  const { ready } = await splitReadyAiEngines(trackerEngines(config.tracker));
  if (!ready.length) return;
  try {
    await startRun(config, "baseline", billing);
  } catch (error) {
    console.warn(`[ai-visibility] ${projectId} onboarding run:`, error);
  }
}
