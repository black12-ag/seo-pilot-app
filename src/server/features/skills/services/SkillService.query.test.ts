import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("@/server/features/site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
import { SkillService } from "./SkillService";
import { SkillScheduleService } from "./SkillScheduleService";
import { SkillScheduleRepository } from "../repositories/SkillScheduleRepository";

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.executeMultiple(
    "DELETE FROM sam_skill_schedules; DELETE FROM sam_skills;",
  );
});
afterAll(testDb.close);

const ORG = "organization";
const OTHER = "foreign";

const save = (
  overrides: Partial<Parameters<typeof SkillService.saveSkill>[0]> = {},
) =>
  SkillService.saveSkill({
    organizationId: ORG,
    name: "weekly-content-check",
    description: "Weekly check of pages losing clicks.",
    instructions: "1. Read the pages.\n2. Report the losers.",
    status: "enabled",
    createdBy: "SEO Pilot app",
    createdByUserId: "user",
    ...overrides,
  });

const customNames = async (organizationId: string) =>
  (await SkillService.listSkills(organizationId))
    .filter((skill) => skill.source === "custom")
    .map((skill) => skill.name);

describe(`skill validation (${testDb.provider})`, () => {
  it.each([
    ["Weekly-Check", "lowercase"],
    ["weekly check", "lowercase"],
    ["-weekly", "lowercase"],
    ["weekly--check", "lowercase"],
    ["seo-audit", "built-in skill"],
    ["a".repeat(61), "limit"],
  ])("refuses the name %j", async (name, copy) => {
    await expect(save({ name })).rejects.toThrow(copy);
    expect(await customNames(ORG)).toEqual([]);
  });

  it("refuses empty or oversized descriptions and instructions", async () => {
    await expect(save({ description: "  " })).rejects.toThrow("description");
    await expect(save({ description: "x".repeat(1_025) })).rejects.toThrow(
      "limit",
    );
    await expect(save({ instructions: "" })).rejects.toThrow("instructions");
    await expect(save({ instructions: "x".repeat(20_001) })).rejects.toThrow(
      "limit",
    );
  });

  it("keeps the description on one line and refuses a duplicate name", async () => {
    await save({ description: "Line one\nline two" });
    const [skill] = await SkillService.listSkills(ORG).then((skills) =>
      skills.filter((row) => row.source === "custom"),
    );
    expect(skill.description).toBe("Line one line two");
    await expect(save()).rejects.toThrow("already exists");
  });
});

describe(`workspace scoping (${testDb.provider})`, () => {
  it("never shows, runs, edits or deletes another workspace's skill", async () => {
    const { skillId } = await save();
    expect(await customNames(OTHER)).toEqual([]);
    expect(
      await SkillService.getRunnableSkill(OTHER, "weekly-content-check"),
    ).toBeNull();
    expect(
      await SkillService.getSkillFile(OTHER, "weekly-content-check"),
    ).toBeNull();
    await expect(
      save({ organizationId: OTHER, skillId, name: "stolen" }),
    ).rejects.toThrow("not in this workspace");
    await expect(
      SkillService.setSkillStatus(OTHER, skillId, "disabled"),
    ).rejects.toThrow("not in this workspace");
    await expect(SkillService.deleteSkill(OTHER, skillId)).rejects.toThrow(
      "not in this workspace",
    );
    const runnable = await SkillService.getRunnableSkill(
      ORG,
      "weekly-content-check",
    );
    expect(runnable?.source).toBe("custom");
  });

  it("lets two workspaces use the same name", async () => {
    await save();
    await save({ organizationId: OTHER });
    expect(await customNames(ORG)).toEqual(["weekly-content-check"]);
    expect(await customNames(OTHER)).toEqual(["weekly-content-check"]);
  });

  it("does not run drafts or skills that are off", async () => {
    await save({ status: "draft" });
    expect(
      await SkillService.getRunnableSkill(ORG, "weekly-content-check"),
    ).toBeNull();
  });
});

describe(`schedules follow their skill (${testDb.provider})`, () => {
  const schedule = {
    skillName: "weekly-content-check",
    enabled: true,
    cadence: "daily" as const,
    weekday: null,
    hour: 8,
    timeZone: "UTC",
  };

  it("renames and deletes a custom skill's schedules with it", async () => {
    const { skillId } = await save();
    await SkillScheduleService.saveSchedule({
      organizationId: ORG,
      projectId: "project",
      userId: "user",
      input: schedule,
    });
    await save({ skillId, name: "content-check" });
    const [renamed] = await SkillScheduleRepository.listForProject("project");
    expect(renamed.skillName).toBe("content-check");
    await SkillService.deleteSkill(ORG, skillId);
    expect(await SkillScheduleRepository.listForProject("project")).toEqual([]);
  });

  it("only turns a schedule on for a skill SAM can run", async () => {
    await save({ status: "draft" });
    const input = { organizationId: ORG, projectId: "project", userId: "user" };
    await expect(
      SkillScheduleService.saveSchedule({ ...input, input: schedule }),
    ).rejects.toThrow("Turn it on first");
    const off = await SkillScheduleService.saveSchedule({
      ...input,
      input: { ...schedule, enabled: false },
    });
    expect(off.nextRunAtMs).toBeNull();
  });
});

describe("SKILL.md export", () => {
  it("writes a custom skill as Agent Skills frontmatter plus its steps", async () => {
    await save({ description: 'Checks "losers": pages that lost clicks.' });
    const file = await SkillService.getSkillFile(ORG, "weekly-content-check");
    const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(file ?? "");
    expect(match).not.toBeNull();
    expect(parseYaml(match?.[1] ?? "")).toEqual({
      name: "weekly-content-check",
      description: 'Checks "losers": pages that lost clicks.',
    });
    expect(match?.[2]).toBe("1. Read the pages.\n2. Report the losers.\n");
  });

  it("serves a built-in skill as the file that ships", async () => {
    const file = await SkillService.getSkillFile(ORG, "seo-audit");
    expect(file).toMatch(/^---\nname: seo-audit\n/);
  });
});
