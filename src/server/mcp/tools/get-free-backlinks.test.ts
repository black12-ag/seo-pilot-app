import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFreeBacklinksTool } from "./get-free-backlinks";
import { makeToolContext, textContent } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  forProject: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/backlinks/services/FreeBacklinksService", () => ({
  FreeBacklinksService: { forProject: mocks.forProject },
}));

const project = { id: "project_1", domain: "example.com" };

describe("get_free_backlinks", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue(project);
  });

  it("reads the project's own prepared data and caps the referrer list", async () => {
    mocks.forProject.mockResolvedValue({
      tracked: [
        { domain: "example.com", role: "site", referringDomains: 3 },
        { domain: "rival.com", role: "competitor", referringDomains: null },
      ],
      selected: {
        domain: "example.com",
        status: "ready",
        release: "cc-main-2026-aug-sep-oct",
        publishedAt: null,
        importedAt: "2026-11-03T04:17:00.000Z",
        referringDomains: 3,
        referrers: [
          { domain: "a.org", hosts: 9 },
          { domain: "b.org", hosts: 4 },
          { domain: "c.org", hosts: 1 },
        ],
      },
    });

    const result = await getFreeBacklinksTool.handler(
      { projectId: "project_1", target: "rival.com", limit: 2 },
      makeToolContext(),
    );

    expect(mocks.forProject).toHaveBeenCalledWith(project, "rival.com");
    expect(result.structuredContent.selected).toMatchObject({
      referrers: [
        { domain: "a.org", hosts: 9 },
        { domain: "b.org", hosts: 4 },
      ],
    });
    const text = textContent(result);
    expect(text).toContain("rival.com (competitor): not prepared");
    expect(text).toContain("cc-main-2026-aug-sep-oct");
    expect(text).not.toContain("c.org");
  });

  it("says how to get data for a domain the project does not track", async () => {
    mocks.forProject.mockResolvedValue({
      tracked: [],
      selected: { domain: "other.com", status: "not_tracked" },
    });

    const result = await getFreeBacklinksTool.handler(
      { projectId: "project_1", target: "other.com" },
      makeToolContext(),
    );

    expect(textContent(result)).toContain("Add it as a competitor");
  });

  it("refuses a project outside the caller's organization", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);

    await expect(
      getFreeBacklinksTool.handler(
        { projectId: "project_x" },
        makeToolContext(),
      ),
    ).rejects.toThrow();
    expect(mocks.forProject).not.toHaveBeenCalled();
  });
});
