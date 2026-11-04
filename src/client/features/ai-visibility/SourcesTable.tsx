import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { AiSourceCohort, AiSourceDomainRow } from "@/shared/ai-visibility";
import { PromptRange, type PromptPeriod } from "./PromptDateRange";
import { aiOwnershipLabel } from "./shared";
import { EngineCounts, cohortWindowLabel } from "./SourcesCohort";

/** The cited domains, or why the selection has none to show. */
export function SourcesTable({
  projectId,
  period,
  cohort,
  rows,
  totalCount,
  ownership,
  providerConfigured,
  onShowAll,
}: {
  projectId: string;
  period: PromptPeriod;
  cohort: AiSourceCohort;
  rows: AiSourceDomainRow[];
  totalCount: number;
  ownership: "all" | AiSourceDomainRow["ownership"];
  providerConfigured: boolean;
  onShowAll: () => void;
}) {
  if (!cohort.runs)
    return (
      <div className="space-y-3 p-10 text-center">
        <p className="text-sm text-muted-foreground">
          {period.preset === PromptRange.All
            ? providerConfigured
              ? "No tracked runs yet. Run Prompt Tracking to collect answers."
              : "Answer collection needs setup, so there are no tracked runs yet."
            : `No tracked runs for this selection, ${cohortWindowLabel(cohort, period)}.`}
        </p>
        {period.preset !== PromptRange.All && (
          <Button size="sm" variant="outline" onClick={onShowAll}>
            Show all available history
          </Button>
        )}
      </div>
    );
  if (!cohort.answers.answered)
    return (
      <p className="p-10 text-center text-sm text-muted-foreground">
        {cohort.answers.pending
          ? "Collecting answers. Cited domains appear here as answers arrive."
          : "No answers were collected for this selection, so nothing can be said about citations."}
      </p>
    );
  if (!totalCount)
    return (
      <p className="p-10 text-center text-sm text-muted-foreground">
        {ownership === "all"
          ? `None of the ${cohort.answers.answered} answers cited a source.`
          : `None of the ${cohort.answers.answered} answers cited a domain of this kind.`}
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Domain</TableHead>
          <TableHead>Ownership</TableHead>
          <TableHead>Cited in</TableHead>
          <TableHead>Prompts</TableHead>
          <TableHead>Pages</TableHead>
          <TableHead>By engine</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.domain}>
            <TableCell className="min-w-48 max-w-md whitespace-normal break-all">
              <Link
                to="/p/$projectId/ai-visibility/sources"
                params={{ projectId }}
                search={{ domain: row.domain }}
                className="text-sm text-primary hover:underline"
              >
                {row.domain}
              </Link>
            </TableCell>
            <TableCell className="whitespace-nowrap text-xs">
              {aiOwnershipLabel(row.ownership)}
            </TableCell>
            <TableCell className="whitespace-nowrap tabular-nums">
              {row.answers} of {cohort.answers.answered} answers
            </TableCell>
            <TableCell className="whitespace-nowrap tabular-nums">
              {row.prompts} of {cohort.prompts}
            </TableCell>
            <TableCell className="tabular-nums">{row.pages}</TableCell>
            <TableCell>
              <EngineCounts cited={row.engines} cohort={cohort} />
            </TableCell>
            <TableCell className="w-10">
              <Button
                variant="ghost"
                size="icon-sm"
                nativeButton={false}
                aria-label={`Show answers citing ${row.domain}`}
                render={
                  <Link
                    to="/p/$projectId/ai-visibility/sources"
                    params={{ projectId }}
                    search={{ domain: row.domain }}
                  />
                }
              >
                <ChevronRight />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
