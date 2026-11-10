import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { captureClientEvent } from "@/client/lib/posthog";
import { saveSkill } from "@/serverFunctions/skills";
import {
  SKILL_MAX_DESCRIPTION_CHARS,
  SKILL_MAX_INSTRUCTIONS_CHARS,
  SKILL_MAX_NAME_CHARS,
  SKILL_NAME_PATTERN,
} from "@/types/schemas/sam-skills";
import type { SkillDraft } from "./skillsShared";

// One form for create, edit and "Duplicate to edit". The name rule is checked
// here for instant feedback; the service checks everything again.
const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the skill a name.")
    .max(SKILL_MAX_NAME_CHARS)
    .regex(
      SKILL_NAME_PATTERN,
      "Lowercase letters, digits and single hyphens, like weekly-content-check.",
    ),
  description: z
    .string()
    .trim()
    .min(1, "Say when SAM should use this skill.")
    .max(SKILL_MAX_DESCRIPTION_CHARS),
  instructions: z
    .string()
    .trim()
    .min(1, "Write the steps SAM should follow.")
    .max(SKILL_MAX_INSTRUCTIONS_CHARS),
});

const INSTRUCTIONS_PLACEHOLDER = `1. Read the project's key pages with read_pages.
2. Check Search Console for pages that lost clicks in the last 28 days.
3. For each, say the likely cause and one fix.
4. Finish with a table: page, clicks lost, cause, fix.`;

export function SkillForm({
  draft,
  onClose,
  onSaved,
}: {
  draft: SkillDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(draft.skillId);
  const saveMutation = useMutation({
    // A refusal comes back as `{ ok: false }` (thrown errors reach the client
    // stripped to their code); rethrowing lets the mutation cache toast it.
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      const result = await saveSkill({
        data: { skillId: draft.skillId, ...values },
      });
      if (!result.ok) throw new Error(result.message);
      return result.value;
    },
    onSuccess: (result) => {
      captureClientEvent("skill:saved", { is_update: !result.created });
      toast.success(result.created ? "Skill created" : "Skill saved");
      onSaved();
    },
  });

  const form = useAppForm({
    defaultValues: {
      name: draft.name,
      description: draft.description,
      instructions: draft.instructions,
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: formSchema },
    onSubmit: ({ value }) => saveMutation.mutateAsync(value),
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saveMutation.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-2xl">
        <form.AppForm>
          <form.Form className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit skill" : "New skill"}</DialogTitle>
            </DialogHeader>

            <form.AppField name="name">
              {(field) => (
                <field.TextField
                  label="Name"
                  description="Lowercase letters, digits and hyphens. It is the skill's folder name when you export it."
                  placeholder="weekly-content-check"
                  required
                />
              )}
            </form.AppField>

            <form.AppField name="description">
              {(field) => (
                <field.TextField
                  label="When to use it"
                  description="One line. SAM reads it to decide when this skill fits."
                  placeholder="Weekly check of pages losing Google clicks, with a fix for each."
                  required
                />
              )}
            </form.AppField>

            <form.AppField name="instructions">
              {(field) => (
                <field.TextareaField
                  label="Instructions"
                  description="Markdown steps, in order. Name the tools SAM should use and the shape of the answer."
                  className="h-64 font-mono leading-relaxed md:text-xs"
                  placeholder={INSTRUCTIONS_PLACEHOLDER}
                  required
                />
              )}
            </form.AppField>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={saveMutation.isPending}
              >
                Cancel
              </Button>
              <form.SubmitButton>
                {editing ? "Save changes" : "Create skill"}
              </form.SubmitButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
