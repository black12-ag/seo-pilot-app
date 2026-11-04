import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { getAiVisibilitySourceDetail } from "@/serverFunctions/ai-visibility";
import {
  aiCollectionMethodLabel,
  type AiEngine,
  type AiMarket,
  type AiSourceAnswer,
  type AiSourceDetail,
} from "@/shared/ai-visibility";
import { AnswerContent } from "./AnswerContent";
import { EngineLabel } from "./EngineLabel";
import type { PromptPeriod } from "./PromptDateRange";
import {
  AiQueryError,
  aiDate,
  aiOwnershipLabel,
  aiVisibilityKey,
} from "./shared";
import { CohortSummary, EngineCounts } from "./SourcesCohort";

export function SourceDetail({
  projectId,
  domain,
  cohort,
  period,
}: {
  projectId: string;
  domain: string;
  cohort: {
    start?: string;
    end?: string;
    engines: AiEngine[] | null;
    market: AiMarket | null;
  };
  period: PromptPeriod;
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const query = useQuery({
    queryKey: [
      ...aiVisibilityKey(projectId),
      "sources",
      "detail",
      domain,
      cohort,
      cursor,
    ],
    queryFn: () =>
      getAiVisibilitySourceDetail({
        data: { projectId, domain, ...cohort, cursor },
      }),
  });
  const back = (
    <Button
      size="sm"
      variant="ghost"
      nativeButton={false}
      render={
        <Link
          to="/p/$projectId/ai-visibility/sources"
          params={{ projectId }}
          search={{}}
        />
      }
    >
      <ChevronLeft />
      All sources
    </Button>
  );
  if (query.isPending)
    return (
      <div className="p-4">
        {back}
        <SkeletonTableRows rows={6} columns={4} className="pt-4" />
      </div>
    );
  if (query.isError)
    return (
      <div className="p-4">
        {back}
        <AiQueryError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      </div>
    );
  const source = query.data;
  const { answered } = source.cohort.answers;
  return (
    <>
      <div className="space-y-2 border-b border-border px-4 py-3">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="break-all text-lg font-semibold">{source.domain}</h2>
          <Badge variant={source.ownership === "own" ? "success" : "secondary"}>
            {aiOwnershipLabel(source.ownership)}
          </Badge>
        </div>
        <p className="text-sm">
          Cited in {source.citedAnswers} of {answered} answers, for{" "}
          {source.citedPrompts} of {source.cohort.prompts} prompts.
        </p>
        <EngineCounts cited={source.engines} cohort={source.cohort} />
      </div>
      <CohortSummary cohort={source.cohort} period={period} />
      {source.citedAnswers ? (
        <>
          <SourcePages source={source} />
          <section aria-label="Answers citing this domain">
            <h3 className="border-b border-border px-4 py-2 text-sm font-medium">
              Answers citing this domain ({source.citedAnswers})
            </h3>
            <ul>
              {source.answers.map((answer) => (
                <SourceAnswerRow
                  key={answer.observationId}
                  projectId={projectId}
                  answer={answer}
                />
              ))}
            </ul>
          </section>
          {(cursor || source.nextCursor) && (
            <div className="flex justify-end gap-2 border-t p-3 border-border">
              <Button
                variant="ghost"
                size="sm"
                disabled={!cursor}
                onClick={() => setCursor(undefined)}
              >
                First page
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!source.nextCursor}
                onClick={() => setCursor(source.nextCursor ?? undefined)}
              >
                Next page <ArrowRight />
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="p-10 text-center text-sm text-muted-foreground">
          No answer cited this domain in this selection.
        </p>
      )}
    </>
  );
}

function SourcePages({ source }: { source: AiSourceDetail }) {
  return (
    <section aria-label="Cited pages" className="border-b border-border">
      <h3 className="border-b border-border px-4 py-2 text-sm font-medium">
        Cited pages ({source.pageCount})
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Page</TableHead>
            <TableHead>Cited in</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {source.pages.map((page) => (
            <TableRow key={page.url}>
              <TableCell className="min-w-60 max-w-2xl whitespace-normal">
                <SafeExternalLink
                  url={page.url}
                  label={page.title || page.url}
                  className="flex items-start gap-1.5 break-all text-sm text-primary hover:underline"
                />
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {page.answers} of {source.citedAnswers} citing answers
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {source.pageCount > source.pages.length && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Showing the {source.pages.length} most cited of {source.pageCount}{" "}
          pages.
        </p>
      )}
    </section>
  );
}

function SourceAnswerRow({
  projectId,
  answer,
}: {
  projectId: string;
  answer: AiSourceAnswer;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-border last:border-0">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Link
            to="/p/$projectId/ai-visibility/prompts/$promptId"
            params={{ projectId, promptId: answer.promptId }}
            className="block text-sm whitespace-pre-wrap hover:underline"
            data-ph-mask
          >
            {answer.prompt}
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <EngineLabel engine={answer.engine} />
            <span>{aiCollectionMethodLabel(answer.engine)}</span>
            <span>{aiDate(answer.collectedAt ?? answer.runCreatedAt)}</span>
            <span>{answer.topic}</span>
          </div>
          <ul className="space-y-0.5 pt-1">
            {answer.pages.map((page) => (
              <li key={page.url}>
                <SafeExternalLink
                  url={page.url}
                  label={page.title || page.url}
                  className="flex items-start gap-1.5 break-all text-xs text-primary hover:underline"
                />
              </li>
            ))}
          </ul>
        </div>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown /> : <ChevronRight />}
          Answer
        </Button>
      </div>
      {open && (
        <div className="border-t border-border bg-muted/20">
          <AnswerContent
            projectId={projectId}
            observationId={answer.observationId}
          />
        </div>
      )}
    </li>
  );
}
