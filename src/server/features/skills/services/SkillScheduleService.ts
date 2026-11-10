import { SkillScheduleRepository } from "@/server/features/skills/repositories/SkillScheduleRepository";
import { SkillService } from "@/server/features/skills/services/SkillService";
import { nextSkillRunAtMs } from "@/server/features/skills/services/skillScheduleTime";
import { AppError } from "@/server/lib/errors";
import type {
  SkillSchedule,
  SkillScheduleInput,
} from "@/types/schemas/sam-skills";

// Schedules run a skill for one project. The caller has authorized the
// project; the organization is the project's.

async function listSchedules(projectId: string): Promise<SkillSchedule[]> {
  return SkillScheduleRepository.listForProject(projectId);
}

/**
 * Create or change the schedule for one skill in one project. Turning it on
 * needs a skill SAM can run (built-in, or this workspace's own and turned on);
 * turning it off always works. The person who saves it is who runs it.
 */
async function saveSchedule(params: {
  organizationId: string;
  projectId: string;
  userId: string;
  input: SkillScheduleInput;
  nowMs?: number;
}): Promise<SkillSchedule> {
  const { input } = params;
  if (
    input.enabled &&
    !(await SkillService.getRunnableSkill(
      params.organizationId,
      input.skillName,
    ))
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      `There is no skill "${input.skillName}" that is turned on in this workspace. Turn it on first.`,
    );
  }
  const fields = {
    userId: params.userId,
    enabled: input.enabled,
    cadence: input.cadence,
    weekday: input.cadence === "weekly" ? input.weekday : null,
    hour: input.hour,
    timeZone: input.timeZone,
    nextRunAtMs: input.enabled
      ? nextSkillRunAtMs(input, params.nowMs ?? Date.now())
      : null,
  };
  const existing = await SkillScheduleRepository.getForProjectSkill(
    params.projectId,
    input.skillName,
  );
  if (existing) {
    await SkillScheduleRepository.updateSchedule(existing.id, fields);
  } else {
    await SkillScheduleRepository.insertSchedule({
      id: crypto.randomUUID(),
      organizationId: params.organizationId,
      projectId: params.projectId,
      skillName: input.skillName,
      ...fields,
    });
  }
  const saved = await SkillScheduleRepository.getForProjectSkill(
    params.projectId,
    input.skillName,
  );
  if (!saved) throw new AppError("INTERNAL_ERROR", "Schedule was not saved");
  return saved;
}

export const SkillScheduleService = { listSchedules, saveSchedule } as const;
