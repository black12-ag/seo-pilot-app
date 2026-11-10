import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Field, FieldLabel } from "@/client/components/ui/field";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Switch } from "@/client/components/ui/switch";
import { captureClientEvent } from "@/client/lib/posthog";
import { saveSkillSchedule } from "@/serverFunctions/skills";
import type {
  SkillSchedule,
  SkillScheduleInput,
} from "@/types/schemas/sam-skills";
import { WEEKDAYS } from "./skillsShared";

const CADENCE_ITEMS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];
const WEEKDAY_ITEMS = WEEKDAYS.map((label, index) => ({
  value: String(index),
  label,
}));
const HOUR_ITEMS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

export function SkillScheduleDialog({
  projectId,
  skillName,
  schedule,
  ai,
  onClose,
  onSaved,
}: {
  projectId: string;
  skillName: string;
  schedule: SkillSchedule | undefined;
  ai: { ready: boolean; message: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<SkillScheduleInput>({
    skillName,
    // Off by default: a new schedule starts off until switched on.
    enabled: schedule?.enabled ?? false,
    cadence: schedule?.cadence ?? "weekly",
    weekday: schedule?.weekday ?? 1,
    hour: schedule?.hour ?? 8,
    timeZone:
      schedule?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const set = (patch: Partial<SkillScheduleInput>) =>
    setValue((current) => ({ ...current, ...patch }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const result = await saveSkillSchedule({
        data: { projectId, schedule: value },
      });
      if (!result.ok) throw new Error(result.message);
      return result.value;
    },
    onSuccess: (saved) => {
      captureClientEvent("skill:schedule_saved", {
        project_id: projectId,
        enabled: saved.enabled,
        cadence: saved.cadence,
      });
      toast.success(saved.enabled ? "Schedule on" : "Schedule saved (off)");
      onSaved();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saveMutation.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Schedule <span className="font-mono">{skillName}</span>
          </DialogTitle>
          <DialogDescription>
            SAM runs the skill for this project on your schedule and saves its
            answer as a report. Each run opens as a chat you can read in SAM.
          </DialogDescription>
        </DialogHeader>

        {!ai.ready ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <strong>Needs AI.</strong>{" "}
            {ai.message ??
              "Set up an AI engine or an OpenRouter key in Settings."}{" "}
            The schedule can be saved, but it does not run until AI is set up.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="flex-row items-center gap-3 sm:col-span-2">
            <Switch
              id="skill-schedule-enabled"
              checked={value.enabled}
              onCheckedChange={(enabled) => set({ enabled })}
            />
            <FieldLabel htmlFor="skill-schedule-enabled">
              {value.enabled ? "On" : "Off"}
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor="skill-schedule-cadence">Repeats</FieldLabel>
            <Select
              items={CADENCE_ITEMS}
              value={value.cadence}
              onValueChange={(cadence) => {
                if (cadence === "daily" || cadence === "weekly")
                  set({ cadence });
              }}
            >
              <SelectTrigger id="skill-schedule-cadence">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CADENCE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {value.cadence === "weekly" ? (
            <Field>
              <FieldLabel htmlFor="skill-schedule-weekday">Day</FieldLabel>
              <Select
                items={WEEKDAY_ITEMS}
                value={String(value.weekday ?? 1)}
                onValueChange={(day) => set({ weekday: Number(day) })}
              >
                <SelectTrigger id="skill-schedule-weekday">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="skill-schedule-hour">Hour</FieldLabel>
            <Select
              items={HOUR_ITEMS}
              value={String(value.hour)}
              onValueChange={(hour) => set({ hour: Number(hour) })}
            >
              <SelectTrigger id="skill-schedule-hour">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOUR_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="skill-schedule-timezone">Timezone</FieldLabel>
            <Input
              id="skill-schedule-timezone"
              value={value.timeZone}
              onChange={(event) => set({ timeZone: event.target.value })}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={saveMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            Save schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
