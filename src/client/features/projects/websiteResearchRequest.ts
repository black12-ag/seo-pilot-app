import { z } from "zod";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import type { ErrorCode } from "@/shared/error-codes";

type ResearchKind = "direct" | "ai" | "content-draft";

const pendingSchema = z.object({
  requestId: z.string().uuid(),
  website: z.string(),
});

const storageKey = (kind: ResearchKind, projectId: string) =>
  `website-research:${kind}:${projectId}`;

export function readPendingResearchRequest(
  kind: ResearchKind,
  projectId: string,
) {
  try {
    const stored = window.sessionStorage.getItem(storageKey(kind, projectId));
    const parsed = stored ? pendingSchema.safeParse(JSON.parse(stored)) : null;
    return parsed?.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The same paid request keeps its ID until it reaches a known result. */
export function researchRequestIdFor(
  kind: ResearchKind,
  projectId: string,
  website: string,
) {
  const pending = readPendingResearchRequest(kind, projectId);
  if (pending?.website === website) return pending.requestId;
  const requestId = crypto.randomUUID();
  try {
    window.sessionStorage.setItem(
      storageKey(kind, projectId),
      JSON.stringify({ requestId, website }),
    );
  } catch {
    // Without storage a reload can't recover this request, but it still runs.
  }
  return requestId;
}

export function clearPendingResearchRequest(
  kind: ResearchKind,
  projectId: string,
) {
  try {
    window.sessionStorage.removeItem(storageKey(kind, projectId));
  } catch {
    // Nothing was stored.
  }
}

/** Only a specific refusal proves nothing ran. An unexpected error may follow a paid run. */
export function clearRefusedResearchRequest(
  kind: ResearchKind,
  projectId: string,
  error: unknown,
) {
  const code = getErrorCode(error);
  if (code && code !== "INTERNAL_ERROR")
    clearPendingResearchRequest(kind, projectId);
}

/** Once the attempt has ended, the next click is a new request. */
export function clearEndedResearchRequest(
  kind: ResearchKind,
  projectId: string,
  attemptId: string,
) {
  if (readPendingResearchRequest(kind, projectId)?.requestId === attemptId)
    clearPendingResearchRequest(kind, projectId);
}

const REFUSAL_MESSAGES: Partial<Record<ErrorCode, string>> = {
  UPSTREAM_UNAVAILABLE:
    "Website setup can’t start yet. An earlier setup needs checking first, or an administrator still has to finish an upgrade step.",
  CONFLICT:
    "Another research run is using this project. Try again when it finishes.",
};

/** Bad-URL advice would mislead when the URL was never tried. */
export function researchErrorMessage(error: unknown) {
  const code = getErrorCode(error);
  if (code === "DATAFORSEO_AUTH_FAILED") return getStandardErrorMessage(error);
  return (
    (code && REFUSAL_MESSAGES[code]) ??
    "We couldn’t research this website. Check the URL and provider settings, then try again."
  );
}
