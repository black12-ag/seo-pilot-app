import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { DashboardActivation } from "@/server/features/dashboard/services/DashboardService";
import { DashboardOnboarding } from "./DashboardOnboarding";
import { setupSteps } from "./dashboardSteps";

vi.mock("@/serverFunctions/dashboard", () => ({
  setDashboardStepDismissed: vi.fn(),
}));
vi.mock("@/serverFunctions/config", () => ({
  getSeoApiKeyStatus: vi.fn(),
}));
vi.mock("./DashboardSetupAction", () => ({
  DashboardSetupAction: () => createElement("div", null, "Connection setup"),
}));

const fresh: DashboardActivation = {
  domain: null,
  ga4: { connected: false, propertyDisplayName: null, cardDismissedAt: null },
  gsc: { connected: false, siteUrl: null },
  mcp: { authorizedAt: null, firstToolCallAt: null, cardDismissed: false },
  competitorResearchedAt: null,
  keywordsResearchedAt: null,
  hasAudit: false,
  hasMultipleProjects: false,
  hasTeammate: false,
  dismissedSteps: [],
};

function renderChecklist(activation = fresh, client = new QueryClient()) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(DashboardOnboarding, {
        projectId: "project-a",
        activation,
      }),
    ),
  );
}

describe("dashboard onboarding visibility", () => {
  it("leaves out the research steps with no DataForSEO key", () => {
    const client = new QueryClient();
    client.setQueryData(["seoApiKeyStatus"], {
      configured: false,
      pageSpeedNeedsKey: true,
    });
    const markup = renderChecklist(fresh, client);
    expect(markup).toContain("Audit your site");
    expect(markup).not.toContain("Explore a competitor");
    expect(markup).not.toContain("Get keyword ideas");
  });

  it("keeps the research steps with a key", () => {
    const client = new QueryClient();
    client.setQueryData(["seoApiKeyStatus"], {
      configured: true,
      pageSpeedNeedsKey: false,
    });
    expect(renderChecklist(fresh, client)).toContain("Explore a competitor");
  });

  it("keeps skipped steps available to restore", () => {
    const markup = renderChecklist({
      ...fresh,
      dismissedSteps: setupSteps.map((step) => step.id),
    });
    expect(markup).toContain("saved for later");
  });

  it("renders nothing once every step is complete", () => {
    expect(
      renderChecklist({
        ...fresh,
        competitorResearchedAt: "2026-09-28",
        keywordsResearchedAt: "2026-09-28",
        hasAudit: true,
        mcp: { ...fresh.mcp, authorizedAt: "2026-09-28" },
        hasTeammate: true,
        hasMultipleProjects: true,
      }),
    ).toBe("");
  });
});
