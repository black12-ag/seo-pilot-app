import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SkillService } from "@/server/features/skills/services/SkillService";
import { SkillScheduleService } from "@/server/features/skills/services/SkillScheduleService";
import { AppError } from "@/server/lib/errors";
import { resolveAiRoute } from "@/server/lib/openrouter";
import {
  getWorkersEnv,
  isHostedServerAuthMode,
} from "@/server/lib/runtime-env";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";
import {
  skillScheduleInputSchema,
  skillStatusSchema,
} from "@/types/schemas/sam-skills";

// Skills belong to the workspace (the caller's organization from the
// authenticated context); schedules belong to a project, whose `projectId` in
// the validator triggers project authorization (ADR 0001).

// Refusals (bad name, duplicate, cap) are the answer the form shows, and
// thrown errors reach the client stripped to their code.
async function asResult<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION_ERROR")
      return { ok: false, message: error.message };
    throw error;
  }
}

/** Whether scheduled skills can run now: SAM's own gate. */
async function aiStatus(): Promise<{ ready: boolean; message: string | null }> {
  if (await isHostedServerAuthMode()) return { ready: true, message: null };
  const route = await resolveAiRoute((await getWorkersEnv()) ?? {});
  return { ready: Boolean(route.access), message: route.message };
}

export const listSkills = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(z.object({ projectId: z.string().min(1) }))
  .handler(async ({ context }) => {
    const [skills, schedules, ai] = await Promise.all([
      SkillService.listSkills(context.organizationId),
      SkillScheduleService.listSchedules(context.projectId),
      aiStatus(),
    ]);
    return { skills, schedules, ai };
  });

export const saveSkill = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(
    z.object({
      skillId: z.string().min(1).optional(),
      name: z.string(),
      description: z.string(),
      instructions: z.string(),
    }),
  )
  .handler(({ data, context }) =>
    asResult(() =>
      SkillService.saveSkill({
        organizationId: context.organizationId,
        ...data,
        // Made by a person in the app: on from the start.
        status: "enabled",
        createdBy: "SEO Pilot app",
        createdByUserId: context.userId,
      }),
    ),
  );

export const setSkillStatus = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(
    z.object({
      skillId: z.string().min(1),
      status: skillStatusSchema.exclude(["draft"]),
    }),
  )
  .handler(async ({ data, context }) => {
    await SkillService.setSkillStatus(
      context.organizationId,
      data.skillId,
      data.status,
    );
    return { skillId: data.skillId };
  });

export const deleteSkill = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(z.object({ skillId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    await SkillService.deleteSkill(context.organizationId, data.skillId);
    return { skillId: data.skillId };
  });

export const getSkillFile = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(z.object({ name: z.string().min(1).max(80) }))
  .handler(async ({ data, context }) => {
    const content = await SkillService.getSkillFile(
      context.organizationId,
      data.name,
    );
    if (content === null)
      throw new AppError("NOT_FOUND", "That skill is not in this workspace.");
    return { content };
  });

export const saveSkillSchedule = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    z.object({
      projectId: z.string().min(1),
      schedule: skillScheduleInputSchema,
    }),
  )
  .handler(({ data, context }) =>
    asResult(() =>
      SkillScheduleService.saveSchedule({
        organizationId: context.organizationId,
        projectId: context.projectId,
        userId: context.userId,
        input: data.schedule,
      }),
    ),
  );
