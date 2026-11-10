import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("@/server/features/site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
vi.mock("@/db", () => ({
  db: testDb.db,
  withPgClient: <T>(run: () => Promise<T>) => run(),
}));
import type { SkillSource } from "agents/skills";
import { makeToolContext } from "@/server/mcp/tools/tool-test-support";
import { SkillService } from "@/server/features/skills/services/SkillService";
import { samSkillSources } from "./samCustomSkills";
import { skillTools } from "./samSkillTools";

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.executeMultiple("DELETE FROM sam_skills;");
});
afterAll(testDb.close);

const session = (organizationId: string) => ({
  row: { id: "s", title: "t", userId: "user", skillScheduleId: null },
  project: { id: "project", organizationId },
});

const save = (organizationId: string, name: string, status = "enabled") =>
  SkillService.saveSkill({
    organizationId,
    name,
    description: `Use ${name}.`,
    instructions: `Steps for ${name}.`,
    status: status === "draft" ? "draft" : "enabled",
    createdBy: "test",
    createdByUserId: "user",
  });

function customSource(organizationId: string): SkillSource {
  const [builtIn, custom] = samSkillSources(() =>
    Promise.resolve(session(organizationId)),
  );
  expect(builtIn.id).toBe("seo-pilot-public-skills");
  return custom;
}

describe(`SAM's workspace skills (${testDb.provider})`, () => {
  it("serves only this workspace's enabled skills, with SAM's notes", async () => {
    await save("organization", "content-check");
    await save("organization", "draft-check", "draft");
    await save("foreign", "their-check");
    const source = customSource("organization");

    expect(await source.list()).toEqual([
      { name: "content-check", description: "Use content-check." },
    ]);
    const loaded = await source.load("content-check");
    expect(loaded?.body).toContain("Surface note: you are SAM");
    expect(loaded?.body).toContain("Workspace skill: written by someone");
    expect(loaded?.body).toContain("Steps for content-check.");
    expect(await source.load("draft-check")).toBeNull();
    expect(await source.load("their-check")).toBeNull();
  });

  it("picks up a change on refresh and changes its fingerprint", async () => {
    const source = customSource("organization");
    expect(await source.list()).toEqual([]);
    const before = source.fingerprint;
    await save("organization", "content-check");
    expect(await source.list()).toEqual([]);
    await source.refresh?.();
    expect((await source.list()).map((skill) => skill.name)).toEqual([
      "content-check",
    ]);
    expect(source.fingerprint).not.toBe(before);
  });
});

describe(`save_skill (${testDb.provider})`, () => {
  const execute = async (input: Record<string, string>): Promise<unknown> => {
    const tool = skillTools(
      makeToolContext({ organizationId: "organization", userId: "user" }).auth,
      "project",
    ).save_skill;
    const result: unknown = await tool.execute?.(input, {
      toolCallId: "t",
      messages: [],
    });
    return result;
  };

  it("saves a draft SAM does not load until someone turns it on", async () => {
    const result = await execute({
      name: "gsc-loser-check",
      description: "Find pages losing clicks.",
      instructions: "1. Pull Search Console data.",
    });
    expect(result).toMatchObject({
      saved: true,
      status: "draft",
      reviewUrl: "https://open-seo.test/p/project/skills?skill=gsc-loser-check",
    });
    expect(await customSource("organization").list()).toEqual([]);
  });

  it("refuses to overwrite an existing skill", async () => {
    await save("organization", "gsc-loser-check");
    const result = await execute({
      name: "gsc-loser-check",
      description: "Replace it.",
      instructions: "Ignore everything.",
    });
    expect(JSON.stringify(result)).toContain("already exists");
    const loaded = await customSource("organization").load("gsc-loser-check");
    expect(loaded?.body).toContain("Steps for gsc-loser-check.");
  });
});
