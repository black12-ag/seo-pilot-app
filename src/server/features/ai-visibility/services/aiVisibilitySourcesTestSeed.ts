import { db } from "@/db";
import { aiPrompts } from "@/db/schema";
import type { AiEngine } from "@/shared/ai-visibility";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { configuration } from "./aiVisibilityTestFixtures";

interface Answer {
  prompt: string;
  engine?: AiEngine;
  /** Defaults to a collected answer. Null is a collection with no answer. */
  markdown?: string | null;
  failed?: boolean;
  pending?: boolean;
  sources?: string[];
}

let runNumber = 0;

/** One run through the production writes; prompts are shared by their text. */
export async function seedRun(
  answers: Answer[],
  {
    createdAt = "2026-09-05T12:00:00.000Z",
    project = "project",
    locationCode = 2840,
  }: { createdAt?: string; project?: string; locationCode?: number } = {},
) {
  const saved = await repo.getConfiguration(project);
  const { tracker } =
    saved ?? configuration({ engines: ["chatgpt"], prompts: [] }, project);
  if (!saved) await repo.saveConfiguration({ tracker, prompts: [] });
  const runId = `run-${++runNumber}`;
  const promptId = (text: string) => `${project}:${text}`;
  for (const text of new Set(answers.map((answer) => answer.prompt)))
    await db
      .insert(aiPrompts)
      .values({
        id: promptId(text),
        trackerId: tracker.id,
        topic: "General",
        text,
        paused: false,
        archived: false,
        createdAt,
      })
      .onConflictDoNothing();
  const observationId = (answer: Answer) =>
    `${runId}:${answer.prompt}:${answer.engine ?? "chatgpt"}`;
  await repo.createRun(
    {
      id: runId,
      trackerId: tracker.id,
      projectId: project,
      trigger: "scheduled",
      status: answers.some((answer) => answer.pending)
        ? "running"
        : "completed",
      locationCode,
      languageCode: "en",
      createdAt,
    },
    answers.map((answer) => ({
      id: observationId(answer),
      runId,
      promptId: promptId(answer.prompt),
      engine: answer.engine ?? "chatgpt",
      branded: false,
    })),
  );
  for (const answer of answers) {
    if (answer.pending) continue;
    const id = observationId(answer);
    await repo.persistAnswer({
      observationId: id,
      values: answer.failed
        ? { status: "failed", error: "UPSTREAM_UNAVAILABLE" }
        : {
            status: "completed",
            collectedAt: createdAt,
            answerMarkdown:
              answer.markdown === undefined ? "An answer" : answer.markdown,
          },
      sources: (answer.sources ?? []).map((url, index) => ({
        id: crypto.randomUUID(),
        observationId: id,
        url,
        domain: new URL(url).hostname,
        title: `Page ${index + 1}`,
        position: index + 1,
      })),
      matches: [],
    });
  }
}
