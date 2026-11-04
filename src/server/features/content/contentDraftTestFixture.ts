import { ContentService } from "./services/ContentService";
import { ContentSourceService } from "./services/ContentSourceService";

export const actor = {
  userId: "user",
  organizationId: "organization",
  role: "owner",
  surface: "web",
} as const;
export const EVIDENCE = "Sencha is steamed for about 30 seconds after picking.";
export const SUPPORTED = {
  text: "Sencha is steamed.",
  kind: "general",
  factual: true,
  citations: [{ source: "S1", quote: EVIDENCE }],
};
export const INVENTED = {
  text: "Invented fact.",
  kind: "general",
  factual: true,
  citations: [],
};

/** A mocked model reply, in the shape the language model call returns. */
export function reply(
  statements: unknown[] = [SUPPORTED],
  { cost = 0.02, extra = {} }: { cost?: number; extra?: object } = {},
) {
  const output = {
    title: "Green tea basics",
    description: "How sencha is made.",
    sections: [
      {
        heading: "How it is made",
        blocks: [{ format: "paragraph", statements }],
      },
    ],
    openQuestions: ["What does the plan include?"],
    omissions: [],
    ...extra,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(output) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    providerMetadata: { openrouter: { usage: { cost } } },
    warnings: [],
  };
}
export const brief = (topic: string) => ({
  target: "",
  objective: "Explain",
  audience: "Readers",
  outputKind: "article",
  topic,
  locale: { language: "en", country: "US" },
});

/** A saved brief at head version 2 with one attributed source attached. */
export async function fixture(text = `Intro line. ${EVIDENCE}`) {
  const { source } = await ContentSourceService.capture(actor, {
    projectId: "project",
    mutationId: crypto.randomUUID(),
    source: {
      kind: "pasted",
      title: "Tea handbook",
      attribution: "Tea Institute",
      text,
      publisherDate: null,
      language: null,
      market: null,
    },
  });
  const created = await ContentService.createBrief(actor, {
    projectId: "project",
    mutationId: crypto.randomUUID(),
    expectedHeadVersion: 0,
    brief: brief("Tea"),
  });
  if (!created.ok) throw new Error("create failed");
  const saved = await ContentService.saveRevision(actor, {
    projectId: "project",
    contentId: created.revision.contentId,
    mutationId: crypto.randomUUID(),
    expectedHeadVersion: 1,
    expectedContextVersion: created.revision.contextVersion,
    brief: created.revision.brief,
    markdown: "Earlier text",
    metadata: created.revision.metadata,
    sourceIds: [source.id],
    claims: [],
    openQuestions: [],
    omissions: [],
  });
  if (!saved.ok) throw new Error("save failed");
  return {
    source,
    request: {
      projectId: "project",
      contentId: created.revision.contentId,
      requestId: crypto.randomUUID(),
      expectedHeadVersion: 2,
      expectedContextVersion: saved.revision.contextVersion,
    },
  };
}
