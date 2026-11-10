import { nextAuditOccurrences } from "@/shared/audit-schedule";
import type { SkillSchedule } from "@/types/schemas/sam-skills";

/**
 * The next run strictly after `afterMs`, on the hour the user chose in their
 * timezone. Same calendar math as recurring audits, so daylight-saving gaps
 * and folds behave the same way.
 */
export function nextSkillRunAtMs(
  schedule: Pick<SkillSchedule, "cadence" | "weekday" | "hour" | "timeZone">,
  afterMs: number,
): number {
  const [next] = nextAuditOccurrences(
    schedule.cadence === "weekly"
      ? {
          cadence: "weekly",
          weekday: schedule.weekday ?? 1,
          hour: schedule.hour,
          minute: 0,
          timeZone: schedule.timeZone,
        }
      : {
          cadence: "daily",
          hour: schedule.hour,
          minute: 0,
          timeZone: schedule.timeZone,
        },
    afterMs,
  );
  return next;
}
