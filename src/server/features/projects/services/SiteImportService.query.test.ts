import { sortBy } from "remeda";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { testDb, google, startFirstAudit } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("@/server/features/site-authority/siteAuthorityTestDb");
  return {
    testDb: await createSiteAuthorityTestDb(),
    // Search Console properties per Google account (the grant's `sub`).
    google: {
      sites: {} as Record<
        string,
        Array<{ siteUrl: string; permissionLevel: string }>
      >,
    },
    startFirstAudit: vi.fn(),
  };
});
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
  waitUntil: () => {},
}));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => true,
  getOptionalEnvValue: async () => undefined,
}));
// Google is never called: each grant lists the properties set per test.
vi.mock("@/server/lib/gscClient", () => ({
  createGscClient: ({ gscAccountId }: { gscAccountId: string }) => ({
    listSites: async () => google.sites[gscAccountId] ?? [],
    getUserInfoEmail: async () => `${gscAccountId}@example.com`,
  }),
}));
vi.mock(
  "@/server/features/dashboard/services/DashboardFirstAuditService",
  () => ({ DashboardFirstAuditService: { start: startFirstAudit } }),
);

import { DataRefreshClaimRepository } from "@/server/features/dashboard/repositories/DataRefreshClaimRepository";
import { buildCacheKey } from "@/server/lib/r2-cache";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { ProjectService } from "./ProjectService";
import { SiteImportService } from "./SiteImportService";

const customer = {
  userId: "user",
  userEmail: "authority@example.com",
  organizationId: "organization",
};
const owned = (siteUrl: string) => ({ siteUrl, permissionLevel: "siteOwner" });

async function projectDomains() {
  const projects = await ProjectService.listProjects("organization");
  return sortBy(
    projects.map((project) => project.domain ?? ""),
    (domain) => domain,
  );
}

afterAll(testDb.close);
beforeEach(async () => {
  // seedProject leaves organization "organization" with example.com and
  // organization "foreign" with other.com.
  await testDb.seedProject();
  await testDb.executeMultiple(`DELETE FROM data_refresh_claims;
    INSERT INTO account (id,account_id,provider_id,user_id,created_at,updated_at)
    VALUES ('grant-a','sub-a','google-search-console','user',0,0);`);
  google.sites = {
    "sub-a": [
      owned("sc-domain:ethio-viral.com"),
      owned("https://www.example.com/"),
      owned("sc-domain:example.com"),
      owned("https://shop.other.com/blog/"),
      owned("sc-domain:other.com"),
      {
        siteUrl: "https://unverified-site.com/",
        permissionLevel: "siteUnverifiedUser",
      },
    ],
  };
  startFirstAudit.mockResolvedValue({ status: "started" });
});

describe("SiteImportService.listImportableSites", () => {
  it("lists one row per domain and marks domains this organization already has", async () => {
    const result = await SiteImportService.listImportableSites({
      organizationId: "organization",
      userId: "user",
    });

    expect(result.connected).toBe(true);
    expect(
      result.sites.map((site) => ({
        domain: site.domain,
        siteUrl: site.siteUrl,
        verified: site.verified,
        existing: site.existingProject?.id ?? null,
      })),
    ).toEqual([
      {
        domain: "ethio-viral.com",
        siteUrl: "sc-domain:ethio-viral.com",
        verified: true,
        existing: null,
      },
      // The domain property wins over the www URL-prefix one.
      {
        domain: "example.com",
        siteUrl: "sc-domain:example.com",
        verified: true,
        existing: "project",
      },
      // other.com belongs to another organization, so it is importable here.
      {
        domain: "other.com",
        siteUrl: "sc-domain:other.com",
        verified: true,
        existing: null,
      },
      {
        domain: "shop.other.com",
        siteUrl: "https://shop.other.com/blog/",
        verified: true,
        existing: null,
      },
      {
        domain: "unverified-site.com",
        siteUrl: "https://unverified-site.com/",
        verified: false,
        existing: null,
      },
    ]);
  });

  it("reports no connection when the user has linked no Google account", async () => {
    await testDb.execute("DELETE FROM account");

    const result = await SiteImportService.listImportableSites({
      organizationId: "organization",
      userId: "user",
    });

    expect(result).toMatchObject({ connected: false, sites: [] });
  });
});

describe("SiteImportService.importSites", () => {
  it("creates, binds and audits each new site, and a second run creates nothing", async () => {
    const sites = [
      { accountId: "sub-a", siteUrl: "sc-domain:ethio-viral.com" },
      { accountId: "sub-a", siteUrl: "https://shop.other.com/blog/" },
      { accountId: "sub-a", siteUrl: "https://www.example.com/" },
    ];

    const first = await SiteImportService.importSites({ customer, sites });

    expect(first.map((r) => [r.domain, r.status])).toEqual([
      ["ethio-viral.com", "created"],
      ["shop.other.com", "created"],
      ["example.com", "exists"],
    ]);
    const created = first.find((r) => r.domain === "ethio-viral.com");
    if (created?.status !== "created") throw new Error("not created");
    expect(
      await ProjectService.getProjectForOrganization(
        "organization",
        created.projectId,
      ),
    ).toMatchObject({ name: "ethio-viral.com", domain: "ethio-viral.com" });
    expect(
      await GscConnectionRepository.getByProjectId(created.projectId),
    ).toMatchObject({
      organizationId: "organization",
      siteUrl: "sc-domain:ethio-viral.com",
      connectedByUserId: "user",
      gscAccountId: "sub-a",
      connectedAccountEmail: "sub-a@example.com",
    });
    expect(startFirstAudit).toHaveBeenCalledWith(
      created.projectId,
      "ethio-viral.com",
      { ...customer, projectId: created.projectId },
    );
    expect(created.initialAudit).toEqual({ status: "started" });
    expect(startFirstAudit).toHaveBeenCalledTimes(2);

    const second = await SiteImportService.importSites({ customer, sites });

    expect(second.map((r) => r.status)).toEqual(["exists", "exists", "exists"]);
    expect(await projectDomains()).toEqual([
      "ethio-viral.com",
      "example.com",
      "shop.other.com",
    ]);
  });

  it("skips a domain another import is creating, then creates it once", async () => {
    const sites = [
      { accountId: "sub-a", siteUrl: "sc-domain:ethio-viral.com" },
    ];
    const key = await buildCacheKey("projects:site-import", {
      organizationId: "organization",
      domain: "ethio-viral.com",
    });
    const held = await DataRefreshClaimRepository.claim(key, "organization");
    if (!held) throw new Error("claim not taken");

    expect(
      await SiteImportService.importSites({ customer, sites }),
    ).toMatchObject([{ status: "in_progress" }]);
    expect(await projectDomains()).toEqual(["example.com"]);

    await DataRefreshClaimRepository.finish(key, held, 0);
    const results = await Promise.all([
      SiteImportService.importSites({ customer, sites }),
      SiteImportService.importSites({ customer, sites }),
    ]);
    expect(
      results.flat().filter((result) => result.status === "created"),
    ).toHaveLength(1);
    expect(await projectDomains()).toEqual(["ethio-viral.com", "example.com"]);
  });

  it("refuses a property the connection can't access and writes nothing", async () => {
    for (const [site, code] of [
      [{ accountId: "sub-a", siteUrl: "sc-domain:not-mine.com" }, "NOT_FOUND"],
      [
        { accountId: "sub-other", siteUrl: "sc-domain:ethio-viral.com" },
        "NOT_FOUND",
      ],
      [
        { accountId: "sub-a", siteUrl: "https://unverified-site.com/" },
        "FORBIDDEN",
      ],
    ] as const) {
      await expect(
        SiteImportService.importSites({
          customer,
          // The refused site comes last: nothing before it may be created.
          sites: [
            { accountId: "sub-a", siteUrl: "sc-domain:ethio-viral.com" },
            site,
          ],
        }),
      ).rejects.toMatchObject({ code });
    }
    expect(await projectDomains()).toEqual(["example.com"]);
    expect(startFirstAudit).not.toHaveBeenCalled();
  });
});
