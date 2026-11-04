import { tool } from "ai";
import { z } from "zod";
import type { ResearchSpend } from "@/server/billing/researchSpend";
import { fetchLiveSerp } from "@/server/lib/dataforseo/serp";
import { DataforseoChargedTaskError } from "@/server/lib/dataforseo/envelope";
import { normalizeBacklinksTarget } from "@/server/lib/dataforseoBacklinksTarget";
import { AppError } from "@/server/lib/errors";
import { readSite } from "@/server/lib/scrape";
import type { RenderUsage } from "@/shared/audit-rendering";
import type { ReadWebsitePage } from "./websiteResearchEvidence";

const SEARCH_RETRIES = 3;
export type SearchState = {
  succeeded: boolean;
  outage: boolean;
  partial: boolean;
};

function isSearchOutage(error: unknown): error is AppError {
  return error instanceof AppError && error.code === "UPSTREAM_UNAVAILABLE";
}

/** Fresh tool budget and captured pages for one model output attempt. */
export function websiteResearchTools(input: {
  market: { locationCode: number; languageCode: string };
  contextUsage: RenderUsage;
  spend: ResearchSpend[];
  sources: Map<string, ReadWebsitePage>;
  state: SearchState;
  ensureAuthorized?: () => Promise<void>;
  markCostIncomplete: () => void;
}) {
  let searched = false;
  let sitesRead = 0;
  return {
    search_competitors: tool({
      description:
        "Search live Google results for competing businesses. Call once with one or two targeted queries based on the business offering.",
      inputSchema: z.object({
        queries: z.array(z.string().min(1).max(200)).min(1).max(2),
      }),
      execute: async ({ queries }) => {
        if (searched)
          throw new Error(
            "The search budget is exhausted. Use the existing results.",
          );
        searched = true;
        const results = await Promise.allSettled(
          queries.map(async (keyword) => {
            let response;
            for (let attempt = 0; ; attempt++) {
              await input.ensureAuthorized?.();
              try {
                response = await fetchLiveSerp({
                  keyword,
                  ...input.market,
                  depth: 10,
                });
                break;
              } catch (error) {
                if (error instanceof DataforseoChargedTaskError)
                  input.spend.push({
                    provider: "dataforseo",
                    creditFeature: "keyword_research",
                    operation: "project_website_research",
                    costUsd: error.billing.costUsd,
                  });
                else input.markCostIncomplete();
                if (
                  attempt === SEARCH_RETRIES ||
                  !isSearchOutage(error) ||
                  error.name === "DataForSEOTimeoutError"
                )
                  throw error;
              }
              await new Promise((resolve) =>
                setTimeout(resolve, 1000 * 2 ** attempt),
              );
            }
            input.spend.push({
              provider: "dataforseo",
              creditFeature: "keyword_research",
              operation: "project_website_research",
              costUsd: response.billing.costUsd,
            });
            return {
              keyword,
              items: response.data
                .filter((item) => item.type === "organic")
                .map((item) => ({
                  title: item.title,
                  url: item.url,
                  description: item.description,
                })),
            };
          }),
        );
        input.state.succeeded = results.some(
          (item) => item.status === "fulfilled",
        );
        input.state.outage = results.every(
          (item) => item.status === "rejected" && isSearchOutage(item.reason),
        );
        input.state.partial = results.some(
          (item) => item.status === "rejected",
        );
        if (input.state.outage)
          return {
            error:
              "Live search is unavailable. Skip competitor research and return no competitors.",
          };
        return results.map((item, index) =>
          item.status === "fulfilled"
            ? item.value
            : {
                keyword: queries[index],
                error:
                  "Live search failed for this query. Use other successful results.",
              },
        );
      },
    }),
    read_business_sites: tool({
      description:
        "Read candidate competitors' websites to verify their offering. Read at most five businesses in total.",
      inputSchema: z.object({
        domains: z.array(z.string().min(1).max(255)).min(1).max(5),
      }),
      execute: async ({ domains }) => {
        sitesRead += domains.length;
        if (sitesRead > 5)
          throw new Error("The website research budget is exhausted.");
        return Promise.all(
          domains.map(async (candidate) => {
            const domain = normalizeBacklinksTarget(candidate, {
              scope: "domain",
            }).apiTarget;
            await input.ensureAuthorized?.();
            const pages = (
              await readSite(
                candidate,
                2,
                input.contextUsage,
                input.ensureAuthorized,
              )
            ).pages;
            const capturedAtMs = Date.now();
            for (const page of pages)
              input.sources.set(page.url, { ...page, capturedAtMs });
            return { domain, pages };
          }),
        );
      },
    }),
  };
}
