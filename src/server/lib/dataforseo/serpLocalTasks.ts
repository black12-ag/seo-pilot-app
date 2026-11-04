import { dataforseoGet, dataforseoPost } from "@/server/lib/dataforseo/core";
import {
  DataforseoChargedTaskError,
  failedResponseError,
  invalidFieldName,
  isNoResultsTask,
  isTaskInProgress,
  type DataforseoApiResponse,
  type DataforseoItemsTask,
  type DataforseoTaskLike,
} from "@/server/lib/dataforseo/envelope";

// ---------------------------------------------------------------------------
// Task-queue Maps searches (local rank grids). One task_post carries every
// grid point, so DataForSEO runs the searches in parallel instead of a Worker
// request waiting on them six at a time, and at the queue's lower price.
// Collection through task_get is free.
// ---------------------------------------------------------------------------

/** High priority finishes in ~10-40 s; the normal queue takes minutes. */
const LOCAL_TASK_PRIORITY_HIGH = 2;

/**
 * Posts one Maps task per coordinate and returns the task ids in input
 * order, null where DataForSEO rejected an entry. Not retried on a 5xx,
 * which does not prove the post went unbilled.
 */
export async function postLocalSerpTasks(input: {
  keyword: string;
  locationCoordinates: string[];
  languageCode: string;
  device: "desktop" | "mobile";
  depth: number;
}): Promise<DataforseoApiResponse<Array<string | null>>> {
  const response = await dataforseoPost<
    DataforseoTaskLike & { id?: string; data?: Record<string, unknown> }
  >(
    "/v3/serp/google/maps/task_post",
    input.locationCoordinates.map((coordinate, index) => ({
      keyword: input.keyword,
      location_coordinate: coordinate,
      language_code: input.languageCode,
      device: input.device,
      os: input.device === "desktop" ? "windows" : "android",
      depth: input.depth,
      search_places: false,
      priority: LOCAL_TASK_PRIORITY_HIGH,
      // Echoed back on each entry, so ids map to points without relying on
      // response order.
      tag: String(index),
    })),
    { maxServerErrorRetries: 0 },
  );
  if (!response || response.status_code !== 20000) {
    throw failedResponseError(response, "DataForSEO task_post failed");
  }

  // Cost is summed over every entry, accepted or not, so anything DataForSEO
  // charged is metered.
  const taskIds: Array<string | null> = input.locationCoordinates.map(
    () => null,
  );
  let costUsd = 0;
  for (const entry of response.tasks ?? []) {
    costUsd += entry.cost ?? 0;
    const index = Number(entry.data?.tag);
    if (entry.status_code === 20100 && entry.id && taskIds[index] === null) {
      taskIds[index] = entry.id;
    } else {
      console.warn(
        `dataforseo.task_post.rejected-entry (${entry.status_code}): ${entry.status_message}`,
      );
    }
  }
  const billing = {
    path: ["v3", "serp", "google", "maps", "task_post"],
    costUsd,
  };
  if (taskIds.every((id) => id === null)) {
    // Charged-task error, so the meter still bills whatever DataForSEO
    // charged, and an uncharged invalid request reads as a validation error.
    const message =
      response.tasks?.[0]?.status_message || "DataForSEO created no tasks";
    throw new DataforseoChargedTaskError(
      message,
      billing,
      invalidFieldName(message) !== null,
    );
  }
  return { data: taskIds, billing };
}

export type LocalSerpTaskOutcome =
  | { status: "pending" }
  | { status: "failed"; message: string }
  | { status: "completed"; items: Record<string, unknown>[] };

/**
 * Collects one queued Maps task. Not metered, like fetchRankCheckTaskResult:
 * the task was charged at task_post.
 */
export async function fetchLocalSerpTaskResult(
  taskId: string,
): Promise<LocalSerpTaskOutcome> {
  const response = await dataforseoGet<
    DataforseoItemsTask<Record<string, unknown>>
  >(`/v3/serp/google/maps/task_get/advanced/${encodeURIComponent(taskId)}`);
  const task = response?.tasks?.[0];
  if (!response || response.status_code !== 20000 || !task) {
    throw failedResponseError(response, "DataForSEO task_get failed");
  }

  if (isTaskInProgress(task)) return { status: "pending" };
  if (task.status_code !== 20000) {
    // "No Search Results" is a billed empty SERP, as on the live path.
    if (isNoResultsTask(task)) return { status: "completed", items: [] };
    return {
      status: "failed",
      message:
        task.status_message || `DataForSEO task failed (${task.status_code})`,
    };
  }
  return { status: "completed", items: task.result?.[0]?.items ?? [] };
}
