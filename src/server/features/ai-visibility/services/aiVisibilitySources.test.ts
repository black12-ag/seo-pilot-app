import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { projectCompetitors } from "@/db/schema";
import { loadAiSourceDetail, loadAiSourceReport } from "./aiVisibilitySources";
import { seedRun } from "./aiVisibilitySourcesTestSeed";

const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("../../site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));

const projectId = "project";
const SEPTEMBER = "2026-09-05T12:00:00.000Z";
const OCTOBER = "2026-10-05T12:00:00.000Z";

const report = (
  filters: Partial<Parameters<typeof loadAiSourceReport>[0]> = {},
) => loadAiSourceReport({ projectId, ownership: "all", limit: 50, ...filters });
const detail = (
  domain: string,
  filters: Partial<Parameters<typeof loadAiSourceDetail>[0]> = {},
) => loadAiSourceDetail({ projectId, domain, ...filters });

beforeEach(() => testDb.seedProject());
afterAll(() => testDb.close());

describe(`source report (${testDb.provider})`, () => {
  it("counts each answer once per domain, over answered collections only", async () => {
    await seedRun([
      // Two pages and a www host of one domain are still one citing answer.
      {
        prompt: "A",
        sources: [
          "https://ahrefs.com/one",
          "https://ahrefs.com/two",
          "https://www.ahrefs.com/three",
        ],
      },
      { prompt: "B", sources: ["https://ahrefs.com/one"] },
      { prompt: "C" },
      // Neither of these is "not cited", and neither cites anything.
      { prompt: "D", markdown: null, sources: ["https://ahrefs.com/empty"] },
      { prompt: "E", failed: true },
      { prompt: "F", pending: true },
    ]);

    const { cohort, rows } = await report();

    expect(cohort.answers).toEqual({
      answered: 3,
      noAnswer: 1,
      failed: 1,
      pending: 1,
    });
    expect(cohort.prompts).toBe(6);
    expect(cohort.runs).toBe(1);
    expect(rows).toEqual([
      {
        domain: "ahrefs.com",
        ownership: "other",
        answers: 2,
        prompts: 2,
        pages: 3,
        engines: [{ engine: "chatgpt", answers: 2 }],
      },
    ]);
  });

  it("labels own, competitor and third-party domains and filters without changing the denominator", async () => {
    await testDb.db.insert(projectCompetitors).values({
      id: "competitor",
      projectId,
      domain: "rival.com",
      name: "Rival",
      updatedBy: "user",
    });
    await seedRun([
      {
        prompt: "A",
        sources: [
          "https://blog.example.com/a",
          "https://rival.com/a",
          "https://reddit.com/a",
        ],
      },
      { prompt: "B" },
    ]);

    const all = await report();
    const competitors = await report({ ownership: "competitor" });

    expect(all.rows.map((row) => [row.domain, row.ownership])).toEqual([
      ["blog.example.com", "own"],
      ["reddit.com", "other"],
      ["rival.com", "competitor"],
    ]);
    expect(competitors.rows.map((row) => row.domain)).toEqual(["rival.com"]);
    expect(competitors.totalCount).toBe(1);
    expect(competitors.cohort.answers.answered).toBe(2);
  });

  it("includes the window start, excludes its end, and reports the runs inside", async () => {
    await seedRun([{ prompt: "A", sources: ["https://before.com/"] }], {
      createdAt: "2026-08-31T23:59:59.999Z",
    });
    await seedRun([{ prompt: "A", sources: ["https://first.com/"] }], {
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    await seedRun([{ prompt: "A", sources: ["https://end.com/"] }], {
      createdAt: "2026-10-01T00:00:00.000Z",
    });

    const { cohort, rows } = await report({
      // Accepts any zero-offset spelling of the instant.
      start: "2026-09-01T00:00:00Z",
      end: "2026-10-01T00:00:00.000Z",
    });

    expect(rows.map((row) => row.domain)).toEqual(["first.com"]);
    expect(cohort).toMatchObject({
      runs: 1,
      start: "2026-09-01T00:00:00.000Z",
      end: "2026-10-01T00:00:00.000Z",
      firstRunAt: "2026-09-01T00:00:00.000Z",
      lastRunAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("filters by engine and still lists the engines the window holds", async () => {
    await seedRun([
      { prompt: "A", engine: "chatgpt", sources: ["https://one.com/"] },
      { prompt: "A", engine: "perplexity", sources: ["https://two.com/"] },
      { prompt: "B", engine: "perplexity", failed: true },
    ]);

    const filtered = await report({ engines: ["perplexity"] });
    const none = await report({ engines: [] });

    expect(filtered.rows.map((row) => row.domain)).toEqual(["two.com"]);
    expect(filtered.cohort.answers).toMatchObject({ answered: 1, failed: 1 });
    expect(filtered.cohort.engines).toEqual([
      {
        engine: "perplexity",
        answered: 1,
        noAnswer: 0,
        failed: 1,
        pending: 0,
      },
    ]);
    expect(filtered.cohort.availableEngines).toEqual(["chatgpt", "perplexity"]);
    expect(none.rows).toEqual([]);
    expect(none.cohort).toMatchObject({ runs: 0, prompts: 0 });
    expect(none.cohort.answers.answered).toBe(0);
  });

  it("flags a window whose runs asked different prompts or engines", async () => {
    const same = [{ prompt: "A" }, { prompt: "B" }];
    await seedRun(same, { createdAt: SEPTEMBER });
    await seedRun(same, { createdAt: OCTOBER });
    expect((await report()).cohort.promptSetVaries).toBe(false);

    await seedRun([{ prompt: "A" }, { prompt: "C" }], {
      createdAt: "2026-10-12T12:00:00.000Z",
    });
    const changed = await report();
    expect(changed.cohort.promptSetVaries).toBe(true);
    expect(changed.cohort.prompts).toBe(3);
  });

  it("never mixes markets: the latest run's market unless another is chosen", async () => {
    await seedRun([{ prompt: "A", sources: ["https://us.com/"] }], {
      createdAt: SEPTEMBER,
      locationCode: 2840,
    });
    await seedRun([{ prompt: "A", sources: ["https://uk.com/"] }], {
      createdAt: OCTOBER,
      locationCode: 2826,
    });
    const us = { locationCode: 2840, languageCode: "en" };

    const latest = await report();
    const chosen = await report({ market: us });
    // A market with no run in the window cannot be selected.
    const stale = await report({
      market: us,
      start: "2026-10-01T00:00:00.000Z",
    });

    expect(latest.rows.map((row) => row.domain)).toEqual(["uk.com"]);
    expect(latest.cohort.market).toEqual({
      locationCode: 2826,
      languageCode: "en",
    });
    expect(latest.cohort.markets).toHaveLength(2);
    expect(latest.cohort.answers.answered).toBe(1);
    expect(chosen.rows.map((row) => row.domain)).toEqual(["us.com"]);
    expect(stale.rows.map((row) => row.domain)).toEqual(["uk.com"]);
    expect(stale.cohort.markets).toHaveLength(1);
  });

  it("orders by citing answers and pages after filtering", async () => {
    await seedRun([
      { prompt: "A", sources: ["https://a.com/", "https://b.com/"] },
      { prompt: "B", sources: ["https://b.com/", "https://c.com/"] },
    ]);

    const first = await report({ limit: 2 });
    const second = await report({
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });

    expect(first.totalCount).toBe(3);
    expect(first.rows.map((row) => row.domain)).toEqual(["b.com", "a.com"]);
    expect(second.rows.map((row) => row.domain)).toEqual(["c.com"]);
    expect(second.nextCursor).toBeNull();
  });

  it("reports nothing and no market for a window without runs", async () => {
    const { cohort, rows, totalCount } = await report();

    expect(rows).toEqual([]);
    expect(totalCount).toBe(0);
    expect(cohort).toMatchObject({ runs: 0, market: null, markets: [] });
  });

  it("never reads another project's runs", async () => {
    await seedRun([{ prompt: "A", sources: ["https://secret.com/page"] }], {
      project: "foreign-project",
    });

    const { cohort, rows } = await report();
    const opened = await detail("secret.com");

    expect(rows).toEqual([]);
    expect(cohort.runs).toBe(0);
    expect(opened.citedAnswers).toBe(0);
    expect(opened.answers).toEqual([]);
    expect(opened.pages).toEqual([]);
  });
});

describe(`source detail (${testDb.provider})`, () => {
  it("lists the pages, answers and prompts behind one domain", async () => {
    await seedRun(
      [
        {
          prompt: "A",
          sources: [
            "https://www.ahrefs.com/one",
            "https://other.com/x",
            "https://ahrefs.com/two",
          ],
        },
        { prompt: "B" },
      ],
      { createdAt: SEPTEMBER },
    );
    await seedRun(
      [
        {
          prompt: "A",
          engine: "perplexity",
          sources: ["https://ahrefs.com/two"],
        },
        { prompt: "C", markdown: null, sources: ["https://ahrefs.com/empty"] },
      ],
      { createdAt: OCTOBER },
    );

    const source = await detail("www.ahrefs.com");

    expect(source).toMatchObject({
      domain: "ahrefs.com",
      ownership: "other",
      citedAnswers: 2,
      citedPrompts: 1,
      pageCount: 2,
      nextCursor: null,
    });
    expect(source.cohort.answers.answered).toBe(3);
    expect(source.cohort.answers.noAnswer).toBe(1);
    expect(source.pages.map((page) => [page.url, page.answers])).toEqual([
      ["https://ahrefs.com/two", 2],
      ["https://www.ahrefs.com/one", 1],
    ]);
    expect(
      source.answers.map((answer) => [
        answer.runCreatedAt,
        answer.prompt,
        answer.engine,
        answer.pages.map((page) => page.url),
      ]),
    ).toEqual([
      [OCTOBER, "A", "perplexity", ["https://ahrefs.com/two"]],
      [
        SEPTEMBER,
        "A",
        "chatgpt",
        ["https://www.ahrefs.com/one", "https://ahrefs.com/two"],
      ],
    ]);
  });

  it("applies the window and engine filter and pages the answers", async () => {
    const prompts = Array.from({ length: 51 }, (_, index) => ({
      prompt: `Prompt ${String(index).padStart(2, "0")}`,
      sources: ["https://ahrefs.com/"],
    }));
    await seedRun(prompts, { createdAt: SEPTEMBER });
    await seedRun(
      [{ prompt: "Later", sources: ["https://ahrefs.com/later"] }],
      { createdAt: OCTOBER },
    );

    const first = await detail("ahrefs.com", { end: OCTOBER });
    const second = await detail("ahrefs.com", {
      end: OCTOBER,
      cursor: first.nextCursor,
    });
    const otherEngine = await detail("ahrefs.com", { engines: ["gemini"] });

    expect(first.citedAnswers).toBe(51);
    expect(first.answers).toHaveLength(50);
    expect(first.nextCursor).toBe("50");
    expect(second.answers.map((answer) => answer.prompt)).toEqual([
      "Prompt 50",
    ]);
    expect(second.nextCursor).toBeNull();
    expect(otherEngine.citedAnswers).toBe(0);
  });

  it("keeps a domain that was not cited empty rather than failing", async () => {
    await seedRun([{ prompt: "A", sources: ["https://ahrefs.com/"] }]);

    const source = await detail("example.com");

    expect(source).toMatchObject({
      ownership: "own",
      citedAnswers: 0,
      answers: [],
    });
    expect(source.cohort.answers.answered).toBe(1);
  });
});
