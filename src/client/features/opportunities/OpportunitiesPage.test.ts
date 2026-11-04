import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type {
  OpportunitiesResult,
  Opportunity,
  OpportunitySource,
} from "@/shared/opportunities";

const query = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/serverFunctions/opportunities", () => ({
  getOpportunities: vi.fn(),
}));
vi.mock("@/serverFunctions/audit", () => ({
  getAuditCapabilities: vi.fn(),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useQuery: () => query.current,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Link: ({ children }: { children: ReactNode }) => children,
}));

import { OpportunitiesPage } from "./OpportunitiesPage";

const link = { label: "Open", target: { page: "context" as const } };
const source = (
  id: OpportunitySource["id"],
  state: OpportunitySource["state"],
): OpportunitySource => ({
  id,
  label: id,
  state,
  detail: `${id} detail`,
  checkedAt: null,
  link,
});
const item = (overrides: Partial<Opportunity>): Opportunity => ({
  id: "item",
  type: "technical",
  title: "Broken internal link",
  whyItMatters: "Why",
  nextStep: "Next",
  severity: "high",
  affected: { count: 40, unit: "page" },
  effort: "medium",
  status: "open",
  evidence: {
    source: "Site audit",
    summary: "40 of 120 crawled pages.",
    observedAt: "2026-11-01T00:00:00.000Z",
    items: [],
    moreCount: 35,
    link,
  },
  ...overrides,
});
const data = (overrides: Partial<OpportunitiesResult>) => ({
  opportunities: [],
  setup: [],
  sources: [
    source("site_audit", "not_checked"),
    source("search_console", "needs_setup"),
    source("ai_visibility", "needs_setup"),
    source("competitors", "checked"),
  ],
  ...overrides,
});
const page = () =>
  renderToStaticMarkup(
    createElement(OpportunitiesPage, { projectId: "project" }),
  );
const loaded = (value: OpportunitiesResult) => {
  query.current = { isPending: false, isError: false, data: value };
};

beforeEach(() => {
  query.current = { isPending: true, isError: false };
});

it("shows a busy state while loading", () => {
  expect(page()).toContain('aria-busy="true"');
});

it("shows a retryable error when the page can't load", () => {
  query.current = {
    isPending: false,
    isError: true,
    error: new Error("boom"),
    refetch: vi.fn(),
    isFetching: false,
  };
  const html = page();
  expect(html).toContain('role="alert"');
  expect(html).toContain("boom");
  expect(html).toContain("Try again");
});

it("says nothing was checked, not zero problems, when only competitors are saved", () => {
  loaded(data({}));
  const html = page();
  expect(html).toContain("Nothing has been checked yet");
  expect(html).toContain("This does not mean your site has no problems");
  expect(html).not.toContain("Nothing to fix");
  expect(html).toContain(
    "Not checked yet: site_audit, search_console, ai_visibility.",
  );
});

it("limits the clean message to what was checked", () => {
  loaded(
    data({
      sources: [
        source("site_audit", "checked"),
        source("search_console", "unavailable"),
        source("ai_visibility", "needs_setup"),
        source("competitors", "checked"),
      ],
    }),
  );
  const html = page();
  expect(html).toContain("Nothing to fix in what was checked");
  expect(html).toContain("The others could still hold problems");
  expect(html).toContain("Not checked yet: ai_visibility.");
  expect(html).toContain("Could not read: search_console.");
});

it("keeps setup work in its own group, without a priority badge", () => {
  loaded(
    data({
      opportunities: [item({})],
      setup: [
        item({
          id: "setup",
          type: "setup",
          title: "Connect Search Console",
          severity: null,
          affected: null,
          status: "needs_setup",
        }),
      ],
    }),
  );
  const html = page();
  const next = html.indexOf("What to do next");
  const setup = html.indexOf("Finish setup");
  expect(html.indexOf("Broken internal link")).toBeGreaterThan(next);
  expect(html.indexOf("Broken internal link")).toBeLessThan(setup);
  expect(html.indexOf("Connect Search Console")).toBeGreaterThan(setup);
  expect(html.match(/High priority/g)).toHaveLength(1);
  expect(html).toContain("These are not problems with your site");
});
