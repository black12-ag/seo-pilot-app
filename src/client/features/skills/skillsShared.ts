import { downloadFile } from "@/client/lib/download";
import { getSkillFile } from "@/serverFunctions/skills";
import type { SkillSchedule } from "@/types/schemas/sam-skills";

export const skillsQueryKey = (projectId: string) =>
  ["skills", projectId] as const;

/** Values the skill form opens with: empty, a skill to edit, or a copy. */
export type SkillDraft = {
  skillId?: string;
  name: string;
  description: string;
  instructions: string;
};

/** Saves the skill as SKILL.md, the file `npx skills add` and agents read. */
export async function downloadSkillFile(name: string) {
  const { content } = await getSkillFile({ data: { name } });
  downloadFile(content, "SKILL.md", "text/markdown");
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** "Weekly · Monday 08:00 Europe/Berlin", or "Off". */
export function scheduleSummary(schedule: SkillSchedule | undefined): string {
  if (!schedule?.enabled) return "Off";
  const day =
    schedule.cadence === "weekly"
      ? `Weekly · ${WEEKDAYS[schedule.weekday ?? 1]}`
      : "Daily";
  return `${day} ${hourLabel(schedule.hour)} ${schedule.timeZone}`;
}

export const lastRunLabel: Record<
  NonNullable<SkillSchedule["lastStatus"]>,
  string
> = {
  running: "Running",
  completed: "Report saved",
  failed: "Failed",
  needs_ai: "Needs AI",
};
