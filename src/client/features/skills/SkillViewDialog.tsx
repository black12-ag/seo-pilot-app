import { Copy, Download, Pencil, Power } from "lucide-react";
import { Markdown } from "@/client/components/Markdown";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import type { SkillListItem } from "@/types/schemas/sam-skills";

// Read a skill. Instructions are user (or SAM) text, so they render through the
// shared Markdown component: raw HTML stays text and links are http(s) only.
export function SkillViewDialog({
  skill,
  onClose,
  onEdit,
  onDuplicate,
  onDownload,
  onTurnOn,
}: {
  skill: SkillListItem;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDownload: () => void;
  onTurnOn: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 font-mono">
            {skill.name}
            {skill.source === "builtin" ? (
              <Badge variant="secondary">Built-in</Badge>
            ) : skill.status === "draft" ? (
              <Badge variant="warning">Draft from SAM</Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>{skill.description}</DialogDescription>
        </DialogHeader>
        {skill.source === "custom" && skill.status === "draft" ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            SAM wrote this draft from a chat. Read the steps, edit anything that
            is off, then turn it on. Until then SAM does not use it.
          </p>
        ) : null}
        <Markdown className="text-sm leading-relaxed">
          {skill.instructions}
        </Markdown>
        <DialogFooter>
          <Button variant="ghost" onClick={onDownload}>
            <Download data-icon="inline-start" />
            Download SKILL.md
          </Button>
          {skill.source === "builtin" ? (
            <Button onClick={onDuplicate}>
              <Copy data-icon="inline-start" />
              Duplicate to edit
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onEdit}>
                <Pencil data-icon="inline-start" />
                Edit
              </Button>
              {skill.status !== "enabled" ? (
                <Button onClick={onTurnOn}>
                  <Power data-icon="inline-start" />
                  Turn on
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
