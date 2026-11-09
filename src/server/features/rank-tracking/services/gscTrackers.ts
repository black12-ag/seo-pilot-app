import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { propertyDomain } from "@/server/features/gsc/propertyDomain";
import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { GscRankQueries } from "@/server/features/rank-tracking/repositories/gscRankQueries";
import { toRankTrackingTimestamp } from "@/server/features/rank-tracking/rankTrackingTimestamps";
import { AppError } from "@/server/lib/errors";
import {
  GscApiError,
  GscNotConnectedError,
  GscTokenError,
} from "@/server/lib/gscErrors";
import { MAX_CONFIGS_PER_PROJECT } from "@/shared/rank-tracking";
import type {
  RankCheckScheduleTime,
  RankTrackingConfig,
} from "@/types/schemas/rank-tracking";
import { resolveNextCheckAt } from "./configSchedule";
import { refreshGscTracker } from "./gscRankSync";

const GSC_NOT_CONNECTED =
  "Connect Search Console for this project to track its rankings for free.";

/**
 * A Search Console tracker for the project's own connected property. The
 * domain always comes from the connection, so it can only track a site the
 * user has verified in Search Console.
 */
export async function createGscTracker(input: {
  projectId: string;
  projectMarket: { locationCode: number; languageCode: string };
  gscCountry?: string;
  devices?: RankTrackingConfig["devices"];
  scheduleInterval?: RankTrackingConfig["scheduleInterval"];
  scheduleTime?: RankCheckScheduleTime;
}): Promise<RankTrackingConfig> {
  const connection = await GscConnectionRepository.getByProjectId(
    input.projectId,
  );
  if (!connection) throw new AppError("VALIDATION_ERROR", GSC_NOT_CONNECTED);
  const domain = propertyDomain(connection.siteUrl);
  if (!domain) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The connected Search Console property has no usable domain.",
    );
  }
  const gscCountry = (input.gscCountry ?? "").toLowerCase();
  // Daily by default: Search Console publishes one day at a time.
  const scheduleInterval = input.scheduleInterval ?? "daily";
  const nextCheckAt = resolveNextCheckAt(scheduleInterval, input.scheduleTime);

  const existing = await GscRankQueries.getGscConfig(
    input.projectId,
    domain,
    gscCountry,
  );
  if (existing?.isActive) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Search Console rankings for this site and country are already tracked",
    );
  }
  const allConfigs = await RankTrackingRepository.getConfigsForProject(
    input.projectId,
  );
  if (allConfigs.length >= MAX_CONFIGS_PER_PROJECT) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Maximum ${MAX_CONFIGS_PER_PROJECT} tracked domains per project`,
    );
  }

  if (existing) {
    await RankTrackingRepository.updateConfig(existing.id, input.projectId, {
      isActive: true,
      devices: input.devices ?? "both",
      scheduleInterval,
      nextCheckAt,
      lastSkipReason: null,
    });
    return { ...existing, isActive: true };
  }

  const config: RankTrackingConfig = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    domain,
    locationCode: input.projectMarket.locationCode,
    languageCode: input.projectMarket.languageCode,
    locationName: null,
    devices: input.devices ?? "both",
    // Unused: Search Console reports every position the site had.
    serpDepth: 100,
    scheduleInterval,
    nextCheckAt,
    isActive: true,
    lastCheckedAt: null,
    lastSkipReason: null,
    source: "gsc",
    gscCountry,
    createdAt: toRankTrackingTimestamp(new Date()),
  };
  await RankTrackingRepository.createConfig(config);
  return config;
}

/**
 * Refresh a Search Console tracker for a user or agent. Google failures the
 * user can act on become AppErrors; everything else stays a real fault.
 */
export async function refreshGscTrackerForUser(config: RankTrackingConfig) {
  try {
    return await refreshGscTracker(config);
  } catch (error) {
    // Not connected, or a grant that can no longer reach the property.
    const lostAccess =
      error instanceof GscApiError &&
      (error.status === 401 || error.status === 403);
    if (
      error instanceof GscNotConnectedError ||
      error instanceof GscTokenError ||
      lostAccess
    ) {
      throw new AppError("VALIDATION_ERROR", GSC_NOT_CONNECTED);
    }
    if (error instanceof GscApiError && error.status === 429) {
      throw new AppError(
        "RATE_LIMITED",
        "Search Console rate limit reached. Try again shortly.",
      );
    }
    throw error;
  }
}
