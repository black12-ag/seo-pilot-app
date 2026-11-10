import type { UIMessage } from "ai";
import { ReportService } from "@/server/features/reports/services/ReportService";
import { SkillScheduleRepository } from "@/server/features/skills/repositories/SkillScheduleRepository";
import { renderSkillReportHtml } from "@/server/features/skills/services/skillReportHtml";
import {
  REPORT_MAX_SUMMARY_CHARS,
  REPORT_MAX_TITLE_CHARS,
} from "@/types/schemas/reports";

// The end of a scheduled skill run: SamChatAgent calls this when the turn in
// a run's session ends. A completed reply becomes a report in the project;
// anything else is recorded on the schedule so the Skills page says why.

function replyText(message: UIMessage | undefined): string {
  return (message?.parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();
}

function summaryOf(markdown: string): string {
  const max = REPORT_MAX_SUMMARY_CHARS - 1;
  return markdown.length <= max ? markdown : `${markdown.slice(0, max)}…`;
}

// Why SAM refused a run's turn, by the telemetry refusal reason.
const REFUSALS: Record<string, string> = {
  credits: "the workspace is out of credits.",
  no_access: "the person who scheduled it no longer has access.",
  no_session: "its chat session is gone.",
};

export async function finishScheduledSkillRun(input: {
  scheduleId: string;
  session: { id: string; title: string; userId: string };
  /** The session's project, checked against the schedule's. */
  project: { id: string; organizationId: string };
  outcome: "completed" | "error" | "aborted";
  /** Set when SAM refused the turn (credits, access) instead of running it. */
  refusal: string | null;
  message: UIMessage | undefined;
}): Promise<void> {
  const { session, project } = input;
  const schedule = await SkillScheduleRepository.getById(input.scheduleId);
  if (
    !schedule ||
    schedule.projectId !== project.id ||
    schedule.organizationId !== project.organizationId
  )
    return;
  // An older run finishing after a newer one started must not overwrite it.
  if (schedule.lastSessionId && schedule.lastSessionId !== session.id) return;
  const fail = (lastMessage: string) =>
    SkillScheduleRepository.recordRun(schedule.id, {
      lastStatus: "failed",
      lastMessage,
    });

  if (input.refusal)
    return fail(`SAM did not run: ${REFUSALS[input.refusal] ?? input.refusal}`);
  if (input.outcome !== "completed")
    return fail(
      input.outcome === "aborted"
        ? "The run was stopped before it finished."
        : "The run hit an error. Open the chat to see it.",
    );
  const markdown = replyText(input.message);
  if (!markdown) return fail("SAM finished without a reply.");

  const title = session.title.slice(0, REPORT_MAX_TITLE_CHARS);
  const saved = await ReportService.saveReport({
    projectId: project.id,
    organizationId: project.organizationId,
    title,
    summary: summaryOf(markdown),
    html: renderSkillReportHtml({
      title,
      subtitle: `Skill: ${schedule.skillName} · written by SAM on a schedule`,
      markdown,
    }),
    skill: schedule.skillName,
    createdBy: "SAM (scheduled skill)",
    createdByUserId: session.userId,
  });
  await SkillScheduleRepository.recordRun(schedule.id, {
    lastStatus: "completed",
    lastMessage: null,
    lastReportId: saved.reportId,
  });
}
