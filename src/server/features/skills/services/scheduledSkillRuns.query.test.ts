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
vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
vi.mock("@/server/lib/openrouter", () => ({ resolveAiRoute: vi.fn() }));
vi.mock("@/server/lib/posthog", () => ({ captureServerEvent: vi.fn() }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => true,
  isHostedServerAuthMode: async () => false,
}));
import { SkillService } from "./SkillService";
import { SkillScheduleService } from "./SkillScheduleService";
import { nextSkillRunAtMs } from "./skillScheduleTime";
import { runDueSkillSchedules } from "./scheduledSkillRuns";
import { finishScheduledSkillRun } from "./scheduledSkillResult";
import { SkillScheduleRepository } from "../repositories/SkillScheduleRepository";

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.executeMultiple(
    "DELETE FROM reports; DELETE FROM sam_sessions; DELETE FROM sam_skill_schedules; DELETE FROM sam_skills;",
  );
});
afterAll(testDb.close);

const SAVED_AT = Date.parse("2026-11-10T06:00:00Z");
const DUE_AT = Date.parse("2026-11-10T08:00:00Z");
const AFTER_DUE = DUE_AT + 60_000;

async function dailySchedule(skillName = "seo-audit") {
  return SkillScheduleService.saveSchedule({
    organizationId: "organization",
    projectId: "project",
    userId: "user",
    input: {
      skillName,
      enabled: true,
      cadence: "daily",
      weekday: null,
      hour: 8,
      timeZone: "UTC",
    },
    nowMs: SAVED_AT,
  });
}

function tick(nowMs: number, ai = { ready: true, message: null }) {
  const startTurn = vi.fn(
    (_turn: { sessionId: string; text: string; idempotencyKey: string }) =>
      Promise.resolve(),
  );
  const run = runDueSkillSchedules({
    nowMs,
    aiRoute: () => Promise.resolve(ai),
    startTurn,
  });
  return { run, startTurn };
}

const sessions = () =>
  testDb.execute("SELECT id, title, skill_schedule_id FROM sam_sessions");

describe("schedule times", () => {
  it("runs weekly on the chosen local day and hour", () => {
    // Wednesday 2026-11-11; Monday 08:00 in Berlin (UTC+1 in November).
    const next = nextSkillRunAtMs(
      { cadence: "weekly", weekday: 1, hour: 8, timeZone: "Europe/Berlin" },
      Date.parse("2026-11-11T12:00:00Z"),
    );
    expect(new Date(next).toISOString()).toBe("2026-11-16T07:00:00.000Z");
  });

  it("runs daily at the next local hour, strictly after now", () => {
    const at = { cadence: "daily", weekday: null, hour: 8 } as const;
    const ny = { ...at, timeZone: "America/New_York" };
    expect(
      new Date(
        nextSkillRunAtMs(ny, Date.parse("2026-11-10T12:00:00Z")),
      ).toISOString(),
    ).toBe("2026-11-10T13:00:00.000Z");
    expect(nextSkillRunAtMs({ ...at, timeZone: "UTC" }, DUE_AT) - DUE_AT).toBe(
      86_400_000,
    );
  });
});

describe(`scheduled runs (${testDb.provider})`, () => {
  it("starts a due run once, in a new session of the person who scheduled it", async () => {
    const schedule = await dailySchedule();
    expect(schedule.nextRunAtMs).toBe(DUE_AT);
    expect(await tick(DUE_AT - 1).run).toBe(0);

    const first = tick(AFTER_DUE);
    expect(await first.run).toBe(1);
    const [session] = await sessions();
    expect(session.skill_schedule_id).toBe(schedule.id);
    expect(String(session.title)).toContain("Scheduled: seo-audit");
    const sessionId = String(session.id);
    const [call] = first.startTurn.mock.calls[0];
    expect(call.sessionId).toBe(sessionId);
    expect(call.text).toContain('Run the "seo-audit" skill');
    expect(call.idempotencyKey).toBe(`${schedule.id}:${DUE_AT}`);
    const after = await SkillScheduleRepository.getById(schedule.id);
    expect(after).toMatchObject({
      lastStatus: "running",
      lastSessionId: sessionId,
      nextRunAtMs: DUE_AT + 86_400_000,
    });

    const again = tick(AFTER_DUE);
    expect(await again.run).toBe(0);
    expect(again.startTurn).not.toHaveBeenCalled();
  });

  it("says it needs AI and does not run without an AI route", async () => {
    const schedule = await dailySchedule();
    const { run, startTurn } = tick(AFTER_DUE, {
      ready: false,
      message: null,
    });
    expect(await run).toBe(0);
    expect(startTurn).not.toHaveBeenCalled();
    expect(await sessions()).toEqual([]);
    const after = await SkillScheduleRepository.getById(schedule.id);
    expect(after).toMatchObject({
      lastStatus: "needs_ai",
      nextRunAtMs: DUE_AT + 86_400_000,
    });
    expect(after?.lastMessage).toContain("Needs AI");
  });

  it("does not run a custom skill that was turned off", async () => {
    const { skillId } = await SkillService.saveSkill({
      organizationId: "organization",
      name: "content-check",
      description: "Check content.",
      instructions: "1. Check.",
      status: "enabled",
      createdBy: "test",
      createdByUserId: "user",
    });
    const schedule = await dailySchedule("content-check");
    await SkillService.setSkillStatus("organization", skillId, "disabled");
    const { run, startTurn } = tick(AFTER_DUE);
    expect(await run).toBe(0);
    expect(startTurn).not.toHaveBeenCalled();
    expect(await SkillScheduleRepository.getById(schedule.id)).toMatchObject({
      lastStatus: "failed",
    });
  });
});

describe(`run results (${testDb.provider})`, () => {
  async function startedRun() {
    const schedule = await dailySchedule();
    await tick(AFTER_DUE).run;
    const [session] = await sessions();
    return {
      schedule,
      input: {
        scheduleId: schedule.id,
        session: { id: String(session.id), title: "Run", userId: "user" },
        project: { id: "project", organizationId: "organization" },
        outcome: "completed" as const,
        refusal: null,
        message: {
          id: "m",
          role: "assistant" as const,
          parts: [
            {
              type: "text" as const,
              text: "## Verdict\n\nFix titles. <script>alert(1)</script> [x](javascript:alert(1))",
            },
          ],
        },
      },
    };
  }

  it("saves the reply as an inert HTML report", async () => {
    const { schedule, input } = await startedRun();
    await finishScheduledSkillRun(input);
    const [report] = await testDb.execute(
      "SELECT id, html, skill, created_by FROM reports",
    );
    expect(report).toMatchObject({
      skill: "seo-audit",
      created_by: "SAM (scheduled skill)",
    });
    const html = String(report.html);
    expect(html).toContain("<h2>Verdict</h2>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(await SkillScheduleRepository.getById(schedule.id)).toMatchObject({
      lastStatus: "completed",
      lastReportId: String(report.id),
    });
  });

  it("records a refused or foreign-project turn without a report", async () => {
    const { schedule, input } = await startedRun();
    await finishScheduledSkillRun({
      ...input,
      project: { id: "foreign-project", organizationId: "foreign" },
    });
    expect(
      (await SkillScheduleRepository.getById(schedule.id))?.lastStatus,
    ).toBe("running");
    await finishScheduledSkillRun({ ...input, refusal: "credits" });
    expect(await testDb.execute("SELECT id FROM reports")).toEqual([]);
    expect(await SkillScheduleRepository.getById(schedule.id)).toMatchObject({
      lastStatus: "failed",
      lastMessage: "SAM did not run: the workspace is out of credits.",
    });
  });
});
