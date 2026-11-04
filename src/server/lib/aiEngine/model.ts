import type { LanguageModelV3 } from "@openrouter/ai-sdk-provider";
import { INCLUDED_IN_SUBSCRIPTION } from "./billing";
import {
  generateWithAiEngine,
  type AiEngineConnection,
  type AiEngineGenerateResult,
} from "./client";
import {
  buildEngineRequest,
  parseEngineReply,
  type CallOptions,
} from "./protocol";

type StreamResult = Awaited<ReturnType<LanguageModelV3["doStream"]>>;

function toUsage(usage: AiEngineGenerateResult["usage"]) {
  return {
    inputTokens: {
      total: usage?.inputTokens ?? undefined,
      noCache: undefined,
      cacheRead: usage?.cachedInputTokens ?? undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage?.outputTokens ?? undefined,
      text: undefined,
      reasoning: usage?.reasoningTokens ?? undefined,
    },
  };
}

async function callEngine(
  connection: AiEngineConnection,
  options: CallOptions,
) {
  const request = buildEngineRequest(options);
  const reply = await generateWithAiEngine(
    connection,
    {
      prompt: request.prompt,
      ...(request.schema ? { schema: request.schema } : {}),
    },
    options.abortSignal,
  );
  const { content, calledTools } = parseEngineReply(request, reply);
  return {
    content,
    finishReason: {
      unified: calledTools ? ("tool-calls" as const) : ("stop" as const),
      raw: undefined,
    },
    usage: toUsage(reply.usage),
    warnings: request.warnings,
    providerMetadata: {
      aiEngine: {
        billing: INCLUDED_IN_SUBSCRIPTION,
        engine: reply.engine,
        model: reply.model,
      },
    },
    response: { modelId: `${reply.engine}/${reply.model}` },
  };
}

/** A model that runs on the operator's own logged-in CLI, through the service. */
export function createAiEngineModel(
  connection: AiEngineConnection,
  route: { engine: string; model: string },
): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "seo-pilot-ai-engine",
    modelId: `${route.engine}/${route.model}`,
    supportedUrls: {},
    doGenerate: (options) => callEngine(connection, options),
    // The CLIs answer in one piece, so a stream is that whole reply.
    doStream: async (options) => {
      const result = await callEngine(connection, options);
      const stream: StreamResult["stream"] = new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "stream-start",
            warnings: result.warnings,
          });
          controller.enqueue({
            type: "response-metadata",
            modelId: result.response.modelId,
          });
          result.content.forEach((part, index) => {
            if (part.type === "text") {
              const id = String(index);
              controller.enqueue({ type: "text-start", id });
              controller.enqueue({ type: "text-delta", id, delta: part.text });
              controller.enqueue({ type: "text-end", id });
            } else if (part.type === "tool-call") {
              controller.enqueue(part);
            }
          });
          controller.enqueue({
            type: "finish",
            finishReason: result.finishReason,
            usage: result.usage,
            providerMetadata: result.providerMetadata,
          });
          controller.close();
        },
      });
      return { stream };
    },
  };
}
