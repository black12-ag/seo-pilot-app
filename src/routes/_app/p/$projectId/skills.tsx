import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { sortBy } from "remeda";
import { z } from "zod";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { SkillForm } from "@/client/features/skills/SkillForm";
import { SkillScheduleDialog } from "@/client/features/skills/SkillScheduleDialog";
import { SkillsList } from "@/client/features/skills/SkillsList";
import { SkillViewDialog } from "@/client/features/skills/SkillViewDialog";
import {
  downloadSkillFile,
  skillsQueryKey,
  type SkillDraft,
} from "@/client/features/skills/skillsShared";
import { captureClientEvent } from "@/client/lib/posthog";
import {
  deleteSkill,
  listSkills,
  setSkillStatus,
} from "@/serverFunctions/skills";
import type { SkillListItem } from "@/types/schemas/sam-skills";

export const Route = createFileRoute("/_app/p/$projectId/skills")({
  // `skill` opens that skill, e.g. from the link SAM gives after save_skill.
  validateSearch: z.object({ skill: z.string().optional() }),
  component: SkillsPage,
});

const EMPTY_DRAFT: SkillDraft = { name: "", description: "", instructions: "" };

// Your own skills first (drafts on top, so SAM's suggestions get read), then
// the built-in ones.
const rank = (skill: SkillListItem) =>
  skill.source === "builtin" ? 2 : skill.status === "draft" ? 0 : 1;

function SkillsPage() {
  const { projectId } = Route.useParams();
  const { skill: openName } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SkillDraft | null>(null);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkillListItem | null>(
    null,
  );

  const skillsQuery = useQuery({
    queryKey: skillsQueryKey(projectId),
    queryFn: () => listSkills({ data: { projectId } }),
    staleTime: 0,
  });
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: skillsQueryKey(projectId) });
  const setOpen = (name: string | undefined) =>
    void navigate({ search: { skill: name }, replace: true });

  const toggleMutation = useMutation({
    mutationFn: (skill: SkillListItem) => {
      if (skill.source !== "custom") throw new Error("Built-in skill");
      const status = skill.status === "enabled" ? "disabled" : "enabled";
      return setSkillStatus({ data: { skillId: skill.id, status } });
    },
    onSuccess: () => {
      toast.success("Skill updated");
      invalidate();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (skillId: string) => deleteSkill({ data: { skillId } }),
    onSuccess: () => {
      captureClientEvent("skill:deleted", {});
      toast.success("Skill deleted");
      setPendingDelete(null);
      invalidate();
    },
  });
  const download = (skill: SkillListItem) =>
    downloadSkillFile(skill.name).catch(() =>
      toast.error("Could not download the skill."),
    );
  const duplicate = (skill: SkillListItem) => {
    setOpen(undefined);
    setForm({
      name: `${skill.name}-custom`,
      description: skill.description,
      instructions: skill.instructions,
    });
  };
  const edit = (skill: SkillListItem) => {
    if (skill.source !== "custom") return duplicate(skill);
    setOpen(undefined);
    setForm({
      skillId: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
    });
  };

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Skills"
          description="Step-by-step workflows SAM follows. Your workspace's skills work in every project; download any skill as SKILL.md for Claude Code or Codex, or schedule one to write a report."
          actions={
            <Button onClick={() => setForm(EMPTY_DRAFT)}>
              <Plus data-icon="inline-start" />
              New skill
            </Button>
          }
        />

        <QueryState query={skillsQuery} errorFallback="Failed to load skills">
          {(data) => {
            const skills = sortBy(data.skills, rank);
            const open = skills.find((skill) => skill.name === openName);
            const target = skills.find((skill) => skill.name === scheduling);
            return (
              <>
                <SkillsList
                  projectId={projectId}
                  skills={skills}
                  schedules={data.schedules}
                  aiReady={data.ai.ready}
                  onView={(skill) => setOpen(skill.name)}
                  onEdit={edit}
                  onDuplicate={duplicate}
                  onToggle={(skill) => toggleMutation.mutate(skill)}
                  onSchedule={(skill) => setScheduling(skill.name)}
                  onDownload={download}
                  onDelete={setPendingDelete}
                />
                {open ? (
                  <SkillViewDialog
                    skill={open}
                    onClose={() => setOpen(undefined)}
                    onEdit={() => edit(open)}
                    onDuplicate={() => duplicate(open)}
                    onDownload={() => void download(open)}
                    onTurnOn={() => toggleMutation.mutate(open)}
                  />
                ) : null}
                {target ? (
                  <SkillScheduleDialog
                    projectId={projectId}
                    skillName={target.name}
                    schedule={data.schedules.find(
                      (schedule) => schedule.skillName === target.name,
                    )}
                    ai={data.ai}
                    onClose={() => setScheduling(null)}
                    onSaved={() => {
                      setScheduling(null);
                      invalidate();
                    }}
                  />
                ) : null}
              </>
            );
          }}
        </QueryState>
      </div>

      {form ? (
        <SkillForm
          draft={form}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            invalidate();
          }}
        />
      ) : null}

      {pendingDelete?.source === "custom" ? (
        <ConfirmDialog
          title={`Delete “${pendingDelete.name}”?`}
          confirmLabel="Delete skill"
          destructive
          pending={deleteMutation.isPending}
          onClose={() => setPendingDelete(null)}
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
        >
          SAM stops using it in every project, and its schedules are deleted.
          Reports it already wrote stay.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
