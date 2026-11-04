import {
  GENERATED_DRAFT_RULE,
  type SavedContentCheckSet,
} from "@/types/schemas/contentEvidence";

export function GeneratedDraftLabel({
  checks,
}: {
  checks: SavedContentCheckSet | null;
}) {
  const note = checks?.checks.find(
    (check) => check.rule === GENERATED_DRAFT_RULE,
  );
  if (!note) return null;
  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="font-medium">Needs human review</p>
      <p className="text-muted-foreground mt-1 break-words">
        {note.explanation}
      </p>
    </div>
  );
}
