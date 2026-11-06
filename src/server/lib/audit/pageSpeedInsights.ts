import { z } from "zod";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { withLighthouseParseLock } from "@/server/lib/lighthouseParseLock";
import {
  buildStoredLighthouseReport,
  lighthouseReportSchema,
  type StoredLighthousePayload,
} from "@/server/lib/lighthouseStoredPayload";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

// Google's PageSpeed Insights API, the route for page speed when there is no
// DataForSEO key. https://developers.google.com/speed/docs/insights/v5/reference
// It returns a Lighthouse report, so it maps through the same stored shape.
const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];
// A run takes Google up to about a minute. The audit step allows 5 minutes.
const REQUEST_TIMEOUT_MS = 120_000;

const NO_ERROR = "NO_ERROR";
// lighthouse.ts logs page failures with this wording as warnings, because
// they mean the tenant's page did not load, not that something here broke.
const PAGE_FAILED = "Lighthouse encountered an error with the following code:";

const responseSchema = z.object({
  lighthouseResult: lighthouseReportSchema
    .extend({
      runtimeError: z
        .object({ code: z.string().optional(), message: z.string().optional() })
        .optional(),
    })
    .optional(),
});

const errorSchema = z.object({
  error: z.object({ message: z.string().optional() }).optional(),
});

// Google's other error text names projects and quotas, so it stays out of what
// is stored on the audit row. The failures a person can act on get a sentence.
async function refusalMessage(response: Response, hasKey: boolean) {
  if (response.status === 429)
    return hasKey
      ? "Google PageSpeed Insights limit reached for this API key. Try again later."
      : "Google PageSpeed Insights refused the check without an API key. Set PAGESPEED_API_KEY to your own free key, then run the audit again.";
  const body = errorSchema.safeParse(await response.json().catch(() => null));
  const message = body.success ? body.data.error?.message : undefined;
  if (message?.startsWith("Lighthouse returned error:"))
    return `${PAGE_FAILED} ${message.slice(26).trim()}`;
  if (hasKey && (response.status === 400 || response.status === 403))
    return "Google rejected PAGESPEED_API_KEY. Check the key, and that the PageSpeed Insights API is enabled for its project.";
  return `Google PageSpeed Insights could not check this page (HTTP ${response.status}).`;
}

export async function fetchPageSpeedReport(input: {
  url: string;
  strategy: "mobile" | "desktop";
}): Promise<StoredLighthousePayload> {
  // Crawled pages already passed this. A URL leaving for a third party is
  // checked once more against the rule that admitted the audit's start URL.
  const url = await normalizeAndValidateStartUrl(input.url);
  const apiKey = await getOptionalEnvValue("PAGESPEED_API_KEY");
  const params = new URLSearchParams({ url, strategy: input.strategy });
  for (const category of CATEGORIES) params.append("category", category);

  // The key goes in a header so it never appears in a URL or a log line.
  const response = await fetch(`${ENDPOINT}?${params}`, {
    headers: apiKey ? { "X-Goog-Api-Key": apiKey } : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(await refusalMessage(response, Boolean(apiKey)));

  return withLighthouseParseLock(async () => {
    const parsed = responseSchema.safeParse(await response.json());
    const report = parsed.success ? parsed.data.lighthouseResult : undefined;
    if (!report)
      throw new Error(
        "Google PageSpeed Insights returned no Lighthouse report.",
      );
    const failure = report.runtimeError;
    if (failure?.code && failure.code !== NO_ERROR)
      throw new Error(`${PAGE_FAILED} ${failure.code}`);
    return buildStoredLighthouseReport({
      report,
      input,
      source: "pagespeed-insights",
      provider: "Google PageSpeed Insights",
      taskId: null,
      cost: null,
    });
  });
}
