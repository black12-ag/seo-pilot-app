import * as React from "react";
import { Input } from "@/client/components/ui/input";
import { FormActions } from "@/client/components/FormActions";
import type { ProjectContextUpdate } from "@/types/schemas/projectContext";
import { EditableListSection } from "./EditableListSection";
import { Provenance, useContextUpdate, type ContextCompetitor } from "./shared";
import { CompetitorResearchPanel } from "./CompetitorResearchPanel";

type CompetitorDraft = { domain: string; name: string; notes: string };

export function CompetitorsSection({
  projectId,
  competitors,
}: {
  projectId: string;
  competitors: ContextCompetitor[];
}) {
  const update = useContextUpdate(projectId);

  const save = (
    previousDomain: string | null,
    draft: CompetitorDraft,
    close: () => void,
  ) => {
    const ops: ProjectContextUpdate[] = [];
    if (previousDomain && previousDomain !== draft.domain.trim()) {
      ops.push({ removeCompetitors: [previousDomain] });
    }
    // Blank values clear stored fields. Omission would preserve agent writes.
    ops.push({
      addCompetitors: [
        {
          domain: draft.domain.trim(),
          name: draft.name.trim(),
          notes: draft.notes.trim(),
        },
      ],
    });
    update.mutate(ops, { onSuccess: close });
  };

  return (
    <div className="space-y-4">
      <EditableListSection
        title="Competitors"
        hint="The sites you measure yourself against."
        addLabel="Add competitor"
        emptyTitle="No competitors yet"
        emptyDescription="Add a competitor manually, or use Discover competitors below to review sourced suggestions."
        items={competitors}
        getId={(item) => item.id}
        getLabel={(item) => item.domain}
        pending={update.isPending}
        onRemove={(item) =>
          update.mutate([{ removeCompetitors: [item.domain] }])
        }
        renderItem={(item) => (
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate text-sm font-medium">
                {item.domain}
              </span>
              {item.name ? (
                <span className="truncate text-xs text-muted-foreground">
                  {item.name}
                </span>
              ) : null}
            </div>
            {item.notes ? (
              <p className="text-sm text-muted-foreground">{item.notes}</p>
            ) : null}
            {item.researchEvidence ? (
              <ResearchSource evidence={item.researchEvidence} />
            ) : null}
            <Provenance by={item.updatedBy} at={item.updatedAt} />
          </div>
        )}
        renderForm={(item, close) => (
          <CompetitorForm
            initial={item}
            pending={update.isPending}
            onCancel={close}
            onSave={(draft) => save(item?.domain ?? null, draft, close)}
          />
        )}
      />
      <CompetitorResearchPanel projectId={projectId} />
    </div>
  );
}

function ResearchSource({
  evidence,
}: {
  evidence: NonNullable<ContextCompetitor["researchEvidence"]>;
}) {
  let url: URL;
  try {
    url = new URL(evidence.sourceUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const date = new Date(evidence.capturedAtMs);
  if (!Number.isFinite(date.valueOf())) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Research source:{" "}
      <a
        className="underline underline-offset-2"
        href={url.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {url.href}
      </a>
      {` · captured ${date.toISOString().slice(0, 10)}`}
    </p>
  );
}

function CompetitorForm({
  initial,
  pending,
  onCancel,
  onSave,
}: {
  initial?: ContextCompetitor;
  pending: boolean;
  onCancel: () => void;
  onSave: (draft: CompetitorDraft) => void;
}) {
  const [draft, setDraft] = React.useState<CompetitorDraft>({
    domain: initial?.domain ?? "",
    name: initial?.name ?? "",
    notes: initial?.notes ?? "",
  });

  return (
    <form
      className="space-y-2 bg-muted/40 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.domain.trim() || pending) return;
        onSave(draft);
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          autoFocus
          value={draft.domain}
          onChange={(event) =>
            setDraft({ ...draft, domain: event.target.value })
          }
          placeholder="competitor.com"
          maxLength={255}
          aria-label="Competitor domain"
        />
        <Input
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          placeholder="Name (optional)"
          maxLength={120}
          aria-label="Competitor name"
        />
      </div>
      <Input
        value={draft.notes}
        onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
        placeholder="Why they matter — e.g. wins every comparison keyword (optional)"
        maxLength={500}
        aria-label="Competitor notes"
      />
      <FormActions
        pending={pending}
        disabled={!draft.domain.trim()}
        onCancel={onCancel}
        size="xs"
      />
    </form>
  );
}
