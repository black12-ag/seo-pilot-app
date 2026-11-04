import { vi } from "vitest";
import { z } from "zod";

export const project = {
  id: "project-1",
  domain: "https://www.example.com/",
  locationCode: 2826,
  languageCode: "en",
};
export const customer = {
  organizationId: "org-1",
  userId: "user-1",
  userEmail: "user@example.com",
};

type RankedFixture = {
  keyword: string;
  volume?: number | null;
  difficulty?: number | null;
  position?: number | null;
  url?: string;
};

function taskResponse(items: RankedFixture[], totalCount: number | null) {
  return Response.json({
    status_code: 20000,
    tasks: [
      {
        status_code: 20000,
        path: ["v3", "dataforseo_labs", "google", "ranked_keywords", "live"],
        cost: 0.01,
        result: [
          {
            total_count: totalCount,
            items: items.map((item) => ({
              keyword_data: {
                keyword: item.keyword,
                keyword_info: { search_volume: item.volume ?? null },
                keyword_properties: {
                  keyword_difficulty: item.difficulty ?? null,
                },
              },
              ranked_serp_element: {
                serp_item: {
                  url: item.url ?? null,
                  rank_absolute: item.position ?? null,
                },
              },
            })),
          },
        ],
      },
    ],
  });
}

export function requestBody(call: Parameters<typeof fetch> | undefined) {
  const body = call?.[1]?.body;
  if (typeof body !== "string") throw new Error("Expected JSON request body");
  const [task] = z
    .array(z.record(z.string(), z.unknown()))
    .parse(JSON.parse(body));
  if (!task) throw new Error("Expected one task");
  return task;
}

export function stubProvider(
  byDomain: Record<
    string,
    { items?: RankedFixture[]; total?: number | null; fail?: boolean }
  >,
) {
  const fetchMock = vi.fn<typeof fetch>(async (...args) => {
    const target = String(requestBody(args).target);
    const entry = byDomain[target];
    if (!entry) throw new Error(`Unexpected target ${target}`);
    if (entry.fail) return new Response("bad request", { status: 400 });
    const items = entry.items ?? [];
    return taskResponse(items, entry.total ?? items.length);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
