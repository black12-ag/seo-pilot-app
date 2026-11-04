import {
  AI_ENGINE_LABELS,
  aiMarketLabel,
  type AiEngine,
  type AiSourceCohort,
} from "@/shared/ai-visibility";
import { EngineLabel } from "./EngineLabel";
import {
  dayLabel,
  promptPeriodLabel,
  type PromptPeriod,
} from "./PromptDateRange";

/** Absolute dates; all history shows the runs it actually covers. */
export function cohortWindowLabel(
  cohort: AiSourceCohort,
  period: PromptPeriod,
) {
  return (
    promptPeriodLabel(period) ??
    (cohort.firstRunAt && cohort.lastRunAt
      ? `${dayLabel(cohort.firstRunAt)} to ${dayLabel(cohort.lastRunAt)}`
      : "All available history")
  );
}

const plural = (count: number, one: string) =>
  `${count} ${one}${count === 1 ? "" : "s"}`;

/** What every count on the page is out of. */
export function CohortSummary({
  cohort,
  period,
}: {
  cohort: AiSourceCohort;
  period: PromptPeriod;
}) {
  const { answers } = cohort;
  return (
    <div className="space-y-2 border-b border-border px-4 py-3 text-sm">
      <p className="font-medium">
        {cohortWindowLabel(cohort, period)}
        {cohort.market && (
          <span className="font-normal text-muted-foreground">
            {" · "}
            {aiMarketLabel(cohort.market)} · {plural(cohort.runs, "run")} ·{" "}
            {plural(cohort.prompts, "prompt")}
          </span>
        )}
      </p>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <Tally label="Answered" value={answers.answered} />
        <Tally label="No answer" value={answers.noAnswer} />
        <Tally
          label="Failed"
          value={answers.failed}
          className={answers.failed ? "text-destructive" : undefined}
        />
        {answers.pending > 0 && (
          <Tally label="In progress" value={answers.pending} />
        )}
      </dl>
      <p className="text-xs text-muted-foreground">
        Citation counts are out of answered collections. No answer, failed and
        in-progress collections are not counted as not cited.
      </p>
      {cohort.promptSetVaries && (
        <p className="text-xs text-warning">
          Runs in this window did not all ask the same prompts and engines.
          These are totals for the window, not a trend.
        </p>
      )}
    </div>
  );
}

function Tally({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className={`flex gap-1.5 ${className ?? ""}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** Each engine's citing answers over its own answered collections. */
export function EngineCounts({
  cited,
  cohort,
}: {
  cited: { engine: AiEngine; answers: number }[];
  cohort: AiSourceCohort;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {cohort.engines
        .filter((engine) => engine.answered > 0)
        .map(({ engine, answered }) => {
          const count =
            cited.find((item) => item.engine === engine)?.answers ?? 0;
          return (
            <span
              key={engine}
              title={`${AI_ENGINE_LABELS[engine]}: ${count} of ${answered} answers`}
              className={`flex items-center gap-1 text-xs tabular-nums ${count ? "" : "text-muted-foreground/60"}`}
            >
              <EngineLabel engine={engine} />
              {count} of {answered}
            </span>
          );
        })}
    </div>
  );
}
