import { sort } from "remeda";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Real migration-applied SQLite, established before the static imports below.
const { client, testDb } = await vi.hoisted(async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const { sort: sortFiles } = await import("remeda");
  const sqliteClient = createClient({ url: "file::memory:" });
  for (const file of sortFiles(
    readdirSync("drizzle/sqlite").filter((name) => name.endsWith(".sql")),
    (a, b) => a.localeCompare(b),
  )) {
    await sqliteClient.executeMultiple(
      readFileSync(`drizzle/sqlite/${file}`, "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  return { client: sqliteClient, testDb: drizzle(sqliteClient) };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE_PROVIDER: "d1",
    SEO_PILOT_OPERATOR_SECRET:
      "test-only-operator-secret-at-least-32-characters",
  },
}));
vi.mock("@/db", () => ({ db: testDb }));
import { handleFreeBacklinksOperatorRequest } from "./freeBacklinksOperator";
import { FreeBacklinksService } from "@/server/features/backlinks/services/FreeBacklinksService";

const SECRET = "test-only-operator-secret-at-least-32-characters";
const RELEASE = "cc-main-2026-aug-sep-oct";
const PUBLISHED = "2026-10-22T18:11:05.000Z";

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM free_backlink_profiles;
    DELETE FROM project_competitors;
    DELETE FROM projects;
    DELETE FROM organization;
    INSERT INTO organization (id,name,slug,created_at) VALUES ('org_a','A','a',0), ('org_b','B','b',0);
    INSERT INTO projects (id,organization_id,name,domain) VALUES
      ('proj_a','org_a','A','https://www.Shop.example.co.uk/'),
      ('proj_b','org_b','B','rival.com'),
      ('proj_old','org_b','Old','gone.com');
    UPDATE projects SET archived_at = '2026-01-01' WHERE id = 'proj_old';
    INSERT INTO project_competitors (id,project_id,domain,updated_by) VALUES
      ('c1','proj_a','blog.competitor.com','user'),
      ('c2','proj_b','secret-competitor.com','user');
  `);
});
afterAll(() => client.close());

function operator(body: unknown, secret = SECRET) {
  return handleFreeBacklinksOperatorRequest(
    new Request("http://127.0.0.1:8080/api/standalone/free-backlinks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-seo-pilot-operator-secret": secret,
      },
      body: JSON.stringify(body),
    }),
  );
}

function importProfile(domain: string, referrers: [string, number][]) {
  return operator({
    command: "import",
    release: RELEASE,
    publishedAt: PUBLISHED,
    profile: { domain, referringDomains: referrers.length + 10, referrers },
  });
}

describe("free backlinks operator endpoint", () => {
  it("answers 404 without the operator secret", async () => {
    const response = await operator({ command: "targets" }, "x".repeat(48));
    expect(response.status).toBe(404);
  });

  it("lists every live site and competitor as registrable domains", async () => {
    const response = await operator({ command: "targets" });
    const body = z
      .object({ domains: z.array(z.string()) })
      .parse(await response.json());
    expect(sort(body.domains, (a, b) => a.localeCompare(b))).toEqual([
      "competitor.com",
      "example.co.uk",
      "rival.com",
      "secret-competitor.com",
    ]);
  });

  it("refuses an import that isn't a valid profile", async () => {
    const response = await operator({
      command: "import",
      release: "../elsewhere",
      publishedAt: null,
      profile: { domain: "example.co.uk", referringDomains: 1, referrers: [] },
    });
    expect(response.status).toBe(400);
  });
});

describe("free backlinks for a project", () => {
  it("shows the project's own site once its data is prepared", async () => {
    expect(
      (await importProfile("example.co.uk", [["news.com", 4]])).status,
    ).toBe(200);
    const result = await FreeBacklinksService.forProject(
      { id: "proj_a", domain: "https://www.Shop.example.co.uk/" },
      undefined,
    );
    expect(result.tracked).toEqual([
      { domain: "example.co.uk", role: "site", referringDomains: 11 },
      { domain: "competitor.com", role: "competitor", referringDomains: null },
    ]);
    expect(result.selected).toMatchObject({
      domain: "example.co.uk",
      status: "ready",
      release: RELEASE,
      publishedAt: PUBLISHED,
      referringDomains: 11,
      referrers: [{ domain: "news.com", hosts: 4 }],
    });
  });

  it("replaces a domain's data on the next refresh", async () => {
    await importProfile("example.co.uk", [["old.com", 1]]);
    await importProfile("example.co.uk", [["new.com", 2]]);
    const result = await FreeBacklinksService.forProject(
      { id: "proj_a", domain: "example.co.uk" },
      "example.co.uk",
    );
    expect(result.selected).toMatchObject({
      referrers: [{ domain: "new.com", hosts: 2 }],
    });
  });

  it("says a tracked competitor isn't prepared yet", async () => {
    const result = await FreeBacklinksService.forProject(
      { id: "proj_a", domain: "example.co.uk" },
      "https://competitor.com/pricing",
    );
    expect(result.selected).toEqual({
      domain: "competitor.com",
      status: "not_prepared",
    });
  });

  it("never shows another organization's competitor", async () => {
    await importProfile("secret-competitor.com", [["news.com", 4]]);
    const result = await FreeBacklinksService.forProject(
      { id: "proj_a", domain: "example.co.uk" },
      "secret-competitor.com",
    );
    expect(result.selected).toEqual({
      domain: "secret-competitor.com",
      status: "not_tracked",
    });
  });
});
