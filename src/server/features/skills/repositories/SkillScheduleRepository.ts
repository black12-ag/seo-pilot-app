import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { samSkillSchedules } from "@/db/schema";
import type { SkillSchedule } from "@/types/schemas/sam-skills";

// Skill schedules. Reads by project are scoped by the caller's authorized
// project; the due scan is the cron's, across every workspace.

const columns = {
  id: samSkillSchedules.id,
  organizationId: samSkillSchedules.organizationId,
  projectId: samSkillSchedules.projectId,
  userId: samSkillSchedules.userId,
  skillName: samSkillSchedules.skillName,
  enabled: samSkillSchedules.enabled,
  cadence: samSkillSchedules.cadence,
  weekday: samSkillSchedules.weekday,
  hour: samSkillSchedules.hour,
  timeZone: samSkillSchedules.timeZone,
  nextRunAtMs: samSkillSchedules.nextRunAtMs,
  lastRunAt: samSkillSchedules.lastRunAt,
  lastStatus: samSkillSchedules.lastStatus,
  lastMessage: samSkillSchedules.lastMessage,
  lastSessionId: samSkillSchedules.lastSessionId,
  lastReportId: samSkillSchedules.lastReportId,
};

async function listForProject(projectId: string): Promise<SkillSchedule[]> {
  return db
    .select(columns)
    .from(samSkillSchedules)
    .where(eq(samSkillSchedules.projectId, projectId))
    .orderBy(asc(samSkillSchedules.skillName));
}

async function getById(id: string): Promise<SkillSchedule | null> {
  const [row] = await db
    .select(columns)
    .from(samSkillSchedules)
    .where(eq(samSkillSchedules.id, id))
    .limit(1);
  return row ?? null;
}

async function getForProjectSkill(
  projectId: string,
  skillName: string,
): Promise<SkillSchedule | null> {
  const [row] = await db
    .select(columns)
    .from(samSkillSchedules)
    .where(
      and(
        eq(samSkillSchedules.projectId, projectId),
        eq(samSkillSchedules.skillName, skillName),
      ),
    )
    .limit(1);
  return row ?? null;
}

type ScheduleFields = Pick<
  SkillSchedule,
  | "userId"
  | "enabled"
  | "cadence"
  | "weekday"
  | "hour"
  | "timeZone"
  | "nextRunAtMs"
>;

async function insertSchedule(
  params: ScheduleFields &
    Pick<SkillSchedule, "id" | "organizationId" | "projectId" | "skillName">,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(samSkillSchedules)
    .values({ ...params, createdAt: now, updatedAt: now });
}

async function updateSchedule(
  id: string,
  values: Partial<ScheduleFields>,
): Promise<void> {
  await db
    .update(samSkillSchedules)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(samSkillSchedules.id, id));
}

/** Schedules whose next run is at or before `nowMs`, oldest first. */
async function listDue(nowMs: number, limit: number): Promise<SkillSchedule[]> {
  return db
    .select(columns)
    .from(samSkillSchedules)
    .where(
      and(
        eq(samSkillSchedules.enabled, true),
        isNotNull(samSkillSchedules.nextRunAtMs),
        lte(samSkillSchedules.nextRunAtMs, nowMs),
      ),
    )
    .orderBy(asc(samSkillSchedules.nextRunAtMs))
    .limit(limit);
}

/**
 * Moves a due schedule to its next slot, only if no other tick already did.
 * True when this caller owns the run.
 */
async function claimDue(
  id: string,
  observedNextRunAtMs: number,
  nextRunAtMs: number,
): Promise<boolean> {
  const claimed = await db
    .update(samSkillSchedules)
    .set({ nextRunAtMs, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(samSkillSchedules.id, id),
        eq(samSkillSchedules.enabled, true),
        eq(samSkillSchedules.nextRunAtMs, observedNextRunAtMs),
      ),
    )
    .returning({ id: samSkillSchedules.id });
  return claimed.length > 0;
}

async function recordRun(
  id: string,
  values: Pick<SkillSchedule, "lastStatus" | "lastMessage"> &
    Partial<
      Pick<SkillSchedule, "lastRunAt" | "lastSessionId" | "lastReportId">
    >,
): Promise<void> {
  await db
    .update(samSkillSchedules)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(samSkillSchedules.id, id));
}

/** Keeps a renamed custom skill's schedules pointing at it. */
async function renameSkill(
  organizationId: string,
  from: string,
  to: string,
): Promise<void> {
  await db
    .update(samSkillSchedules)
    .set({ skillName: to, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(samSkillSchedules.organizationId, organizationId),
        eq(samSkillSchedules.skillName, from),
      ),
    );
}

async function deleteForSkill(
  organizationId: string,
  skillName: string,
): Promise<void> {
  await db
    .delete(samSkillSchedules)
    .where(
      and(
        eq(samSkillSchedules.organizationId, organizationId),
        eq(samSkillSchedules.skillName, skillName),
      ),
    );
}

export const SkillScheduleRepository = {
  listForProject,
  getById,
  getForProjectSkill,
  insertSchedule,
  updateSchedule,
  listDue,
  claimDue,
  recordRun,
  renameSkill,
  deleteForSkill,
} as const;
