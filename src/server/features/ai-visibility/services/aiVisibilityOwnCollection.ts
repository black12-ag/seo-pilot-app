import {
  askOwnAiEngine,
  parseAiEngineAnswer,
  resolveOwnAiEngine,
} from "../providers/aiEngineEvidence";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { aiMarketLabel } from "@/shared/ai-visibility";
import {
  runBrands,
  saveAiAnswer,
  type AiRunMarket,
  type AiTask,
} from "./aiVisibilityCollection";
import { AI_ANSWER_FAILURES } from "./aiVisibilityErrors";

// One workflow step body, like those in aiVisibilityCollection.

/**
 * Asks each prompt of an own AI engine batch, one at a time, and saves each
 * answer as it arrives. These answers cost no data credits and are not
 * metered. A failed answer fails alone with our own copy, never the engine's
 * text. A retried step skips answers an earlier attempt finished.
 */
export async function collectAiOwnBatch(
  runId: string,
  market: AiRunMarket,
  tasks: AiTask[],
): Promise<void> {
  const brands = await runBrands(runId);
  if (!brands) return;
  const stillPending = new Set(await repo.listPendingObservationIds(runId));
  const todo = tasks.filter((task) => stillPending.has(task.tag));
  if (!todo.length) return;
  const engine = await resolveOwnAiEngine();
  if (!engine.available) {
    await repo.failPendingObservations(
      runId,
      AI_ANSWER_FAILURES.ownEngineOff,
      todo.map((task) => task.tag),
    );
    return;
  }
  for (const task of todo) {
    try {
      const reply = await askOwnAiEngine(engine.access, {
        prompt: task.prompt,
        market: aiMarketLabel(market),
      });
      await saveAiAnswer(task.tag, parseAiEngineAnswer(reply.text), brands, {
        answeredBy: reply.answeredBy,
        answerMode: "model_knowledge",
      });
    } catch (cause) {
      console.warn(
        `[ai-visibility] ${runId} own engine answer ${task.tag} failed:`,
        cause instanceof Error ? cause.name : "error",
      );
      await repo.failPendingObservations(
        runId,
        AI_ANSWER_FAILURES.ownEngineFailed,
        [task.tag],
      );
    }
  }
}
