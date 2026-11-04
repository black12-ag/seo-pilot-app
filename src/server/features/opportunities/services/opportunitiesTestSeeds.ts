import { AiVisibilityRepository } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { configuration } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";
import { CompetitorResearchRepository } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { actor } from "@/server/features/projects/repositories/websiteResearchAttemptTestDb";
import { sha256Hex } from "@/server/lib/audit/ids";

const projectId = "ccd86b7c-9726-4853-91bb-9eb3e481ba7a";
export const opportunityTestProjectId = projectId;

/** Audit rows written as plain SQL, so the service reads what a crawl would store. */
export const seedAuditWith =
  (execute: (statement: string) => Promise<unknown>) =>
  async (input: {
    id: string;
    project?: string;
    status?: string;
    startedAt: string;
    pagesCrawled?: number;
    issues?: { type: string; severity: string; pages: number }[];
  }) => {
    await execute(
      `insert into audits (id,project_id,started_by_user_id,start_url,status,pages_crawled,started_at,completed_at)
     values ('${input.id}','${input.project ?? projectId}','user','https://example.com','${input.status ?? "completed"}',${input.pagesCrawled ?? 120},'${input.startedAt}','${input.startedAt}')`,
    );
    for (const issue of input.issues ?? [])
      for (let page = 0; page < issue.pages; page++)
        await execute(
          `insert into audit_issues (id,audit_id,page_url,issue_type,severity)
         values ('${input.id}-${issue.type}-${page}','${input.id}','https://example.com/${String(page).padStart(3, "0")}','${issue.type}','${issue.severity}')`,
        );
  };

const own = { name: "Project", domain: "example.com", own: true };
const rival = { name: "Rival", domain: "rival.com", own: false };
type Answer = {
  markdown?: string | null;
  failed?: boolean;
  branded?: boolean;
  ownNamed?: boolean;
  rivalCited?: boolean;
};

export async function seedAiRun(answers: Answer[], project = projectId) {
  const config = configuration({ engines: ["chatgpt"], prompts: [] }, project);
  const createdAt = "2026-11-01T10:00:00.000Z";
  const prompts = answers.map((_, index) => ({
    id: `${project}-prompt-${index}`,
    trackerId: config.tracker.id,
    topic: "General",
    text: `Question ${index}?`,
    paused: false,
    archived: false,
    createdAt,
  }));
  await AiVisibilityRepository.saveConfiguration({ ...config, prompts });
  const runId = `${project}-run`;
  await AiVisibilityRepository.createRun(
    {
      id: runId,
      trackerId: config.tracker.id,
      projectId: project,
      trigger: "scheduled",
      status: "completed",
      locationCode: 2840,
      languageCode: "en",
      createdAt,
      completedAt: createdAt,
    },
    prompts.map((prompt, index) => ({
      id: `${runId}-${index}`,
      runId,
      promptId: prompt.id,
      engine: "chatgpt",
      branded: !!answers[index].branded,
    })),
  );
  for (const [index, answer] of answers.entries())
    await AiVisibilityRepository.persistAnswer({
      observationId: `${runId}-${index}`,
      values: answer.failed
        ? { status: "failed", error: "UPSTREAM_UNAVAILABLE" }
        : {
            status: "completed",
            answerMarkdown:
              answer.markdown === undefined ? "An answer" : answer.markdown,
          },
      sources: [],
      matches: answer.failed
        ? []
        : [
            { ...own, mentioned: !!answer.ownNamed, cited: false },
            { ...rival, mentioned: false, cited: !!answer.rivalCited },
          ].map((brand) => ({
            ...brand,
            id: crypto.randomUUID(),
            observationId: `${runId}-${index}`,
            firstMention: null,
          })),
    });
}

/** A finished research run holding one verified competitor, not yet reviewed. */
export async function seedResearchRun() {
  const { scope, snapshot } = await CompetitorResearchRepository.getSnapshot(
    actor,
    projectId,
  );
  const runId = crypto.randomUUID();
  const candidateId = crypto.randomUUID();
  const excerpt = "Rival provides similar services";
  await CompetitorResearchRepository.admitSetup(scope, {
    id: runId,
    projectId,
    requestId: crypto.randomUUID(),
    requestHash: "a".repeat(64),
    snapshot,
    businessSummary: "Project",
    modelBackendId: null,
    modelConfigurationHash: "b".repeat(64),
    nowMs: 1000,
    deadlineAtMs: 300000,
  });
  await CompetitorResearchRepository.recordSetupEvidence(scope, {
    runId,
    snapshot,
    outcome: "complete",
    nowMs: 1100,
    candidates: [
      {
        id: candidateId,
        domain: "rival.com",
        name: "Rival",
        notes: "Similar",
        source: {
          url: "https://rival.com/about",
          excerpt,
          textHash: await sha256Hex(excerpt),
          capturedAtMs: 1050,
        },
        extractionMethod: "legacy_read_site",
        partialEvidence: false,
      },
    ],
  });
  return { scope, snapshot, runId, candidateId };
}

export function connectSearchConsole(
  project = projectId,
  organizationId = "organization",
) {
  return GscConnectionRepository.upsert({
    projectId: project,
    organizationId,
    siteUrl: "sc-domain:example.com",
    connectedByUserId: "user",
    gscAccountId: "account",
    connectedAccountEmail: null,
  });
}
