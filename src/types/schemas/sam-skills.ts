import { z } from "zod";
import { timeZoneSchema } from "@/types/schemas/schedule-time";

// Shared vocabulary for skills: built-in skills bundled from .agents/skills and
// the custom skills a workspace writes. The caps and the name rule are enforced
// in SamSkillService with actionable copy; Zod at each boundary checks shape.

/** Agent Skills names: lowercase letters, digits and single hyphens. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Agent Skills allows 64; 60 keeps it within the report list's skill column. */
export const SKILL_MAX_NAME_CHARS = 60;
/** The Agent Skills format caps the description at 1,024 characters. */
export const SKILL_MAX_DESCRIPTION_CHARS = 1_024;
/**
 * Every enabled skill's instructions can be loaded into a SAM turn, so a skill
 * is a procedure, not a knowledge base.
 */
export const SKILL_MAX_INSTRUCTIONS_CHARS = 20_000;
/** Per workspace. SAM's skill catalog lists every enabled one each turn. */
export const SKILL_MAX_PER_ORGANIZATION = 50;

export const skillStatusSchema = z.enum(["draft", "enabled", "disabled"]);
export type SkillStatus = z.infer<typeof skillStatusSchema>;

/** A stored custom skill. */
export type CustomSkill = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  instructions: string;
  status: SkillStatus;
  createdBy: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

/** A row on the Skills page: built-in (read-only) or this workspace's own. */
export type SkillListItem =
  | {
      source: "builtin";
      name: string;
      description: string;
      instructions: string;
    }
  | ({ source: "custom" } & CustomSkill);

export const skillScheduleStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "needs_ai",
]);

export type SkillSchedule = {
  id: string;
  organizationId: string;
  projectId: string;
  userId: string;
  skillName: string;
  enabled: boolean;
  cadence: "daily" | "weekly";
  weekday: number | null;
  hour: number;
  timeZone: string;
  nextRunAtMs: number | null;
  lastRunAt: string | null;
  lastStatus: z.infer<typeof skillScheduleStatusSchema> | null;
  lastMessage: string | null;
  lastSessionId: string | null;
  lastReportId: string | null;
};

export const skillScheduleInputSchema = z
  .object({
    skillName: z.string().min(1).max(SKILL_MAX_NAME_CHARS),
    enabled: z.boolean(),
    cadence: z.enum(["daily", "weekly"]),
    weekday: z.number().int().min(0).max(6).nullable(),
    hour: z.number().int().min(0).max(23),
    timeZone: timeZoneSchema.refine(
      (value) => !/^[+-]/.test(value),
      "Use an IANA timezone name, not a fixed offset",
    ),
  })
  .refine((value) => value.cadence !== "weekly" || value.weekday !== null, {
    message: "Pick a weekday for a weekly schedule.",
    path: ["weekday"],
  });
export type SkillScheduleInput = z.infer<typeof skillScheduleInputSchema>;
