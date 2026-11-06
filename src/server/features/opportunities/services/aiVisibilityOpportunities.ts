import { groupByProp, sort } from "remeda";
import { AiVisibilityRepository } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { loadAiPageResults } from "@/server/features/ai-visibility/services/aiVisibilityResults";
import { hasDataforseoAccess } from "@/server/lib/provider-access";
import { formatCount } from "@/shared/format";
import type { Opportunity, OpportunitySeverity } from "@/shared/opportunities";
import {
  plural,
  SAMPLE_SIZE,
  setupNudge,
  SOURCE_META,
  type SourceInput,
  type SourceReading,
} from "./opportunityParts";

function isPresent(brand: { mentioned: boolean; cited: boolean }) {
  return brand.mentioned || brand.cited;
}

export async function readAiVisibility({
  projectId,
}: SourceInput): Promise<SourceReading> {
  const { label, link } = SOURCE_META.ai_visibility;
  const notChecked = (
    state: "not_checked" | "needs_setup",
    detail: string,
    checkedAt: string | null,
    setup: Opportunity[] = [],
  ): SourceReading => ({
    source: { ...SOURCE_META.ai_visibility, state, detail, checkedAt },
    opportunities: [],
    setup,
  });
  const configuration =
    await AiVisibilityRepository.getConfiguration(projectId);
  const hasPrompts = configuration?.prompts.some((prompt) => !prompt.archived);
  if (!hasPrompts) {
    // Tracking can't run with no key, so it isn't a setup step to nag about.
    if (!(await hasDataforseoAccess()))
      return notChecked(
        "not_checked",
        "Optional: needs a DataForSEO key.",
        null,
      );
    const detail = "No AI visibility prompts are set up for this project.";
    return notChecked("needs_setup", detail, null, [
      setupNudge({
        id: "setup:ai-visibility",
        title: "Set up AI visibility tracking",
        whyItMatters:
          "Tracked prompts show whether AI answers name your brand, and which competitors they name instead.",
        nextStep: "Choose the prompts to track on the AI visibility page.",
        evidence: {
          source: "Project settings",
          summary: detail,
          observedAt: null,
          items: [],
          moreCount: 0,
          link,
        },
      }),
    ]);
  }
  const runs = await AiVisibilityRepository.listRuns(projectId);
  const run = runs.find(
    (row) => row.status === "completed" || row.status === "partial",
  );
  if (!run)
    return notChecked(
      "not_checked",
      "Prompts are saved, but no check has finished yet.",
      null,
    );
  const checkedAt = run.completedAt ?? run.createdAt;
  const results = await loadAiPageResults({
    projectId,
    runId: run.id,
    includeHistory: false,
    competitorGap: false,
    branded: "neutral",
  });
  const { completed, expected } = results.coverage;
  if (!completed)
    return notChecked(
      "not_checked",
      "The last check collected no answers to compare.",
      checkedAt,
    );

  // A prompt counts only from answers that were collected. Failed and empty
  // answers say nothing about the brand, so they are left out, not counted.
  const prompts = Object.values(
    groupByProp(
      results.rows.filter(
        (row) =>
          row.answerStatus === "answered" &&
          row.brands.some((brand) => brand.own),
      ),
      "promptId",
    ),
  );
  const missing = prompts.flatMap((answers) => {
    const brands = answers.flatMap((answer) => answer.brands);
    if (brands.some((brand) => brand.own && isPresent(brand))) return [];
    return [
      {
        promptId: answers[0].promptId,
        prompt: answers[0].prompt,
        rivals: [
          ...new Set(
            brands
              .filter((brand) => !brand.own && isPresent(brand))
              .map((brand) => brand.name),
          ),
        ],
      },
    ];
  });
  const answeredPrompts = prompts.length;
  const build = (
    id: string,
    rows: typeof missing,
    copy: Pick<Opportunity, "title" | "whyItMatters" | "nextStep">,
    severity: OpportunitySeverity,
    summary: string,
  ): Opportunity[] =>
    rows.length
      ? [
          {
            ...copy,
            id,
            type: "ai_visibility",
            severity,
            affected: { count: rows.length, unit: "prompt" },
            effort: "medium",
            status: "open",
            evidence: {
              source: label,
              summary,
              observedAt: checkedAt,
              items: sort(
                rows,
                (a, b) =>
                  b.rivals.length - a.rivals.length ||
                  a.prompt.localeCompare(b.prompt),
              )
                .slice(0, SAMPLE_SIZE)
                .map((row) => ({
                  label: row.prompt,
                  detail: row.rivals.length
                    ? `Named or cited instead: ${row.rivals.join(", ")}`
                    : undefined,
                  target: { page: "ai_prompt", promptId: row.promptId },
                })),
              moreCount: Math.max(0, rows.length - SAMPLE_SIZE),
              link,
            },
          },
        ]
      : [];

  const gaps = missing.filter((row) => row.rivals.length);
  const absent = missing.filter((row) => !row.rivals.length);
  const rivalCounts = new Map<string, number>();
  for (const name of gaps.flatMap((row) => row.rivals))
    rivalCounts.set(name, (rivalCounts.get(name) ?? 0) + 1);
  const rivalSummary = sort(
    [...rivalCounts],
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )
    .map(([name, count]) => `${name} in ${plural(count, "prompt")}`)
    .join(", ");
  return {
    source: {
      ...SOURCE_META.ai_visibility,
      state: "checked",
      detail: `${formatCount(completed)} of ${plural(expected, "answer")} collected across ${plural(answeredPrompts, "prompt")}.`,
      checkedAt,
      link,
    },
    setup: [],
    opportunities: [
      ...build(
        "ai-visibility:competitor-gap",
        gaps,
        {
          title: "AI answers name competitors instead of you",
          whyItMatters:
            "People reading these answers see a competitor and never see your brand.",
          nextStep:
            "Read the answers and the sources they cite, then publish a clear page on the same question.",
        },
        "medium",
        `${formatCount(gaps.length)} of ${plural(answeredPrompts, "answered prompt")}. ${rivalSummary}.`,
      ),
      ...build(
        "ai-visibility:brand-absent",
        absent,
        {
          title: "AI answers don't mention your brand",
          whyItMatters:
            "These answers name neither you nor a saved competitor, so the topic is still open.",
          nextStep:
            "Check whether your site answers these questions directly, and add a page where it doesn't.",
        },
        "low",
        `${formatCount(absent.length)} of ${plural(answeredPrompts, "answered prompt")}.`,
      ),
    ],
  };
}
