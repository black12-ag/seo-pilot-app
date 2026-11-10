import { getAgentByName } from "agents";
import type { SamChatAgent } from "@/server/features/sam/SamChatAgent";
import { SamSessionRepository } from "@/server/features/sam/SamSessionRepository";
import { SkillScheduleRepository } from "@/server/features/skills/repositories/SkillScheduleRepository";
import { SkillService } from "@/server/features/skills/services/SkillService";
import { nextSkillRunAtMs } from "@/server/features/skills/services/skillScheduleTime";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { describeError } from "@/server/lib/errors";
import { resolveAiRoute } from "@/server/lib/openrouter";
import { usesBetterAuthServer } from "@/server/lib/runtime-env";
import type { SkillSchedule } from "@/types/schemas/sam-skills";

// The cron body for scheduled skills. A due schedule is first moved to its next
// slot (so a failing one never blocks the rest), then run as a SAM turn in a
// new chat session owned by the person who scheduled it. That turn runs on
// the same AI route, tools, billing gate and metering as a chat the person
// typed; SamChatAgent saves its reply as a report when the turn ends.

// Each run is a full agent turn, so a tick starts only a few.
const RUNS_PER_TICK = 5;

const NEEDS_AI_MESSAGE =
  "Needs AI: set up an AI engine or an OpenRouter key in Settings. Scheduled skills don't run without one.";

function runPrompt(skillName: string): string {
  return [
    `Run the "${skillName}" skill for this project now: activate it with activate_skill and follow its steps.`,
    "This is a scheduled run. Nobody is watching this chat, so don't ask questions: make sensible assumptions and say what you assumed.",
    "Don't start new paid tracking, schedules or large batches of paid lookups the skill would normally ask the user to confirm; note them as recommendations instead.",
    "Finish with the complete findings as one Markdown reply: a one-line verdict, the key numbers, and the next actions. That reply is saved as this run's report.",
  ].join("\n\n");
}

const runTitle = (skillName: string, nowMs: number) =>
  `Scheduled: ${skillName} · ${new Date(nowMs).toISOString().slice(0, 16).replace("T", " ")} UTC`;

type RunDeps = {
  nowMs: number;
  /** Whether an AI route exists now, and why not when it doesn't. */
  aiRoute: () => Promise<{ ready: boolean; message: string | null }>;
  /** Queues the prompt as a turn in the given SAM session. */
  startTurn: (input: {
    sessionId: string;
    text: string;
    idempotencyKey: string;
  }) => Promise<void>;
};

async function runOne(
  schedule: SkillSchedule,
  dueAtMs: number,
  deps: RunDeps,
  ai: { ready: boolean; message: string | null },
): Promise<boolean> {
  const lastRunAt = new Date(deps.nowMs).toISOString();
  const record = (
    lastStatus: SkillSchedule["lastStatus"],
    lastMessage: string | null,
    extra: { lastSessionId?: string } = {},
  ) =>
    SkillScheduleRepository.recordRun(schedule.id, {
      lastStatus,
      lastMessage,
      lastRunAt,
      ...extra,
    });

  if (!ai.ready) {
    await record("needs_ai", ai.message ?? NEEDS_AI_MESSAGE);
    return false;
  }
  if (
    !(await SkillService.getRunnableSkill(
      schedule.organizationId,
      schedule.skillName,
    ))
  ) {
    await record(
      "failed",
      `The skill "${schedule.skillName}" is turned off or was deleted.`,
    );
    return false;
  }
  // Accounts with real members: a person who left the workspace no longer
  // runs anything in it.
  if (
    (await usesBetterAuthServer()) &&
    !(await AuthRepository.getMembership(
      schedule.userId,
      schedule.organizationId,
    ))
  ) {
    await SkillScheduleRepository.updateSchedule(schedule.id, {
      enabled: false,
      nextRunAtMs: null,
    });
    await record(
      "failed",
      "The person who scheduled this left the workspace, so it was turned off.",
    );
    return false;
  }
  const session = await SamSessionRepository.createSession({
    projectId: schedule.projectId,
    userId: schedule.userId,
    title: runTitle(schedule.skillName, deps.nowMs),
    skillScheduleId: schedule.id,
  });
  if (!session) throw new Error("Failed to create the run's chat session");
  // Recorded first: a refused turn can end before startTurn returns, and its
  // result is only kept for the schedule's latest session.
  await record("running", null, { lastSessionId: session.id });
  await deps.startTurn({
    sessionId: session.id,
    text: runPrompt(schedule.skillName),
    idempotencyKey: `${schedule.id}:${dueAtMs}`,
  });
  return true;
}

/** One tick: start the due runs, oldest first. */
export async function runDueSkillSchedules(deps: RunDeps): Promise<number> {
  const due = await SkillScheduleRepository.listDue(deps.nowMs, RUNS_PER_TICK);
  if (!due.length) return 0;
  const ai = await deps.aiRoute();
  let started = 0;
  for (const schedule of due) {
    if (schedule.nextRunAtMs === null) continue;
    const dueAtMs = schedule.nextRunAtMs;
    try {
      const claimed = await SkillScheduleRepository.claimDue(
        schedule.id,
        dueAtMs,
        nextSkillRunAtMs(schedule, deps.nowMs),
      );
      if (!claimed) continue;
      if (await runOne(schedule, dueAtMs, deps, ai)) started++;
    } catch (error) {
      console.error("[skills] scheduled run failed to start", {
        scheduleId: schedule.id,
        error: describeError(error),
      });
      await SkillScheduleRepository.recordRun(schedule.id, {
        lastStatus: "failed",
        lastMessage: "The scheduled run could not start.",
        lastRunAt: new Date(deps.nowMs).toISOString(),
      }).catch(() => undefined);
    }
  }
  return started;
}

/** Cron entry point. */
export async function runScheduledSkills(env: Env): Promise<void> {
  // env.d.ts declares the DO bindings untyped (ambient contexts can't import
  // the classes); narrow here so the RPC is typed.
  const namespace =
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the binding is declared as this class in wrangler.jsonc
    env.SAM_CHAT as unknown as DurableObjectNamespace<SamChatAgent>;
  await runDueSkillSchedules({
    nowMs: Date.now(),
    aiRoute: async () => {
      const route = await resolveAiRoute(env);
      return { ready: Boolean(route.access), message: route.message };
    },
    startTurn: async ({ sessionId, text, idempotencyKey }) => {
      // RPC typing turns submitMessages' result into `never` (it is not a
      // serializable type); the call itself resolves once the turn is queued.
      const stub =
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same method, typed as the promise the RPC returns
        (await getAgentByName(namespace, sessionId)) as unknown as {
          submitMessages: (
            ...args: Parameters<SamChatAgent["submitMessages"]>
          ) => Promise<unknown>;
        };
      await stub.submitMessages(
        [
          {
            id: crypto.randomUUID(),
            role: "user",
            parts: [{ type: "text", text }],
          },
        ],
        { idempotencyKey },
      );
    },
  });
}
