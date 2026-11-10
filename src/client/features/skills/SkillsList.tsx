import { Link } from "@tanstack/react-router";
import {
  CalendarClock,
  Copy,
  Download,
  Eye,
  Pencil,
  Power,
  Trash2,
} from "lucide-react";
import { RowActionsMenu } from "@/client/components/RowActionsMenu";
import { Badge } from "@/client/components/ui/badge";
import { DropdownMenuItem } from "@/client/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { SkillListItem, SkillSchedule } from "@/types/schemas/sam-skills";
import { lastRunLabel, scheduleSummary } from "./skillsShared";

type Actions = {
  onView: (skill: SkillListItem) => void;
  onEdit: (skill: SkillListItem) => void;
  onDuplicate: (skill: SkillListItem) => void;
  onToggle: (skill: SkillListItem) => void;
  onSchedule: (skill: SkillListItem) => void;
  onDownload: (skill: SkillListItem) => void;
  onDelete: (skill: SkillListItem) => void;
};

function StatusBadge({ skill }: { skill: SkillListItem }) {
  if (skill.source === "builtin")
    return <Badge variant="secondary">Built-in</Badge>;
  if (skill.status === "draft")
    return <Badge variant="warning">Draft · review</Badge>;
  if (skill.status === "disabled") return <Badge variant="outline">Off</Badge>;
  return <Badge variant="success">On</Badge>;
}

function ScheduleCell({
  projectId,
  schedule,
  aiReady,
}: {
  projectId: string;
  schedule: SkillSchedule | undefined;
  aiReady: boolean;
}) {
  if (!schedule?.enabled)
    return <span className="text-muted-foreground">Off</span>;
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span>{scheduleSummary(schedule)}</span>
        {!aiReady ? <Badge variant="warning">Needs AI</Badge> : null}
      </div>
      {schedule.lastStatus ? (
        <div className="text-xs text-muted-foreground">
          Last run: {lastRunLabel[schedule.lastStatus]}
          {schedule.lastReportId ? (
            <>
              {" · "}
              <Link
                to="/p/$projectId/reports/$reportId"
                params={{ projectId, reportId: schedule.lastReportId }}
                className="underline underline-offset-2"
              >
                report
              </Link>
            </>
          ) : null}
          {schedule.lastSessionId ? (
            <>
              {" · "}
              <Link
                to="/p/$projectId/sam"
                params={{ projectId }}
                search={{ s: schedule.lastSessionId }}
                className="underline underline-offset-2"
              >
                chat
              </Link>
            </>
          ) : null}
          {schedule.lastMessage ? (
            <div className="text-warning-foreground dark:text-warning">
              {schedule.lastMessage}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SkillsList({
  projectId,
  skills,
  schedules,
  aiReady,
  ...actions
}: {
  projectId: string;
  skills: SkillListItem[];
  schedules: SkillSchedule[];
  aiReady: boolean;
} & Actions) {
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Skill</TableHead>
            <TableHead>When SAM uses it</TableHead>
            <TableHead>Schedule (this project)</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {skills.map((skill) => {
            const custom = skill.source === "custom";
            const runnable = !custom || skill.status === "enabled";
            return (
              <TableRow key={`${skill.source}:${skill.name}`}>
                <TableCell className="align-top">
                  <div className="flex flex-col items-start gap-1">
                    <button
                      type="button"
                      className="text-left font-mono text-sm font-medium hover:underline"
                      onClick={() => actions.onView(skill)}
                    >
                      {skill.name}
                    </button>
                    <StatusBadge skill={skill} />
                  </div>
                </TableCell>
                <TableCell className="max-w-[420px] align-top text-muted-foreground">
                  {skill.description}
                </TableCell>
                <TableCell className="align-top text-sm">
                  <ScheduleCell
                    projectId={projectId}
                    schedule={schedules.find(
                      (schedule) => schedule.skillName === skill.name,
                    )}
                    aiReady={aiReady}
                  />
                </TableCell>
                <TableCell className="w-10 text-right align-top">
                  <RowActionsMenu label={`Actions for ${skill.name}`}>
                    <DropdownMenuItem onClick={() => actions.onView(skill)}>
                      <Eye />
                      View
                    </DropdownMenuItem>
                    {custom ? (
                      <>
                        <DropdownMenuItem onClick={() => actions.onEdit(skill)}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => actions.onToggle(skill)}
                        >
                          <Power />
                          {skill.status === "enabled" ? "Turn off" : "Turn on"}
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <DropdownMenuItem
                        onClick={() => actions.onDuplicate(skill)}
                      >
                        <Copy />
                        Duplicate to edit
                      </DropdownMenuItem>
                    )}
                    {runnable ? (
                      <DropdownMenuItem
                        onClick={() => actions.onSchedule(skill)}
                      >
                        <CalendarClock />
                        Schedule
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onClick={() => actions.onDownload(skill)}>
                      <Download />
                      Download SKILL.md
                    </DropdownMenuItem>
                    {custom ? (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => actions.onDelete(skill)}
                      >
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    ) : null}
                  </RowActionsMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableCard>
  );
}
