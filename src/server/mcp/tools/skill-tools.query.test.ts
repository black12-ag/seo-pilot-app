import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("@/server/features/site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
import { SkillService } from "@/server/features/skills/services/SkillService";
import { getSkillTool, listSkillsTool } from "./skill-tools";
import { makeToolContext } from "./tool-test-support";

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.executeMultiple("DELETE FROM sam_skills;");
  for (const [organizationId, name, status] of [
    ["organization", "content-check", "enabled"],
    ["organization", "draft-check", "draft"],
    ["foreign", "their-check", "enabled"],
  ] as const) {
    await SkillService.saveSkill({
      organizationId,
      name,
      description: `Use ${name}.`,
      instructions: `Steps for ${name}.`,
      status,
      createdBy: "test",
      createdByUserId: "user",
    });
  }
});
afterAll(testDb.close);

const context = makeToolContext({ organizationId: "organization" });

describe(`skills over MCP (${testDb.provider})`, () => {
  it("lists built-in skills and this workspace's enabled ones only", async () => {
    const result = await listSkillsTool.handler({}, context);
    const skills = (result.structuredContent?.skills ?? []) as {
      name: string;
      source: string;
    }[];
    const custom = skills.filter((skill) => skill.source === "custom");
    expect(custom.map((skill) => skill.name)).toEqual(["content-check"]);
    expect(skills.some((skill) => skill.name === "seo-audit")).toBe(true);
  });

  it("returns a workspace skill as SKILL.md", async () => {
    const result = await getSkillTool.handler(
      { name: "content-check" },
      context,
    );
    expect(result.structuredContent).toMatchObject({
      name: "content-check",
      source: "custom",
      skillMd:
        "---\nname: content-check\ndescription: Use content-check.\n---\n\nSteps for content-check.\n",
    });
  });

  it("does not serve drafts or another workspace's skills", async () => {
    for (const name of ["draft-check", "their-check"]) {
      await expect(getSkillTool.handler({ name }, context)).rejects.toThrow(
        "No skill",
      );
    }
  });
});
