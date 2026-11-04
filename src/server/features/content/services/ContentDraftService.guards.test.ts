import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
// The migration-applied fixture must exist before static repository imports.
const { testDb, doGenerate, hosted, access, spend } = await vi.hoisted(
  async () => {
    const { createSiteAuthorityTestDb } =
      await import("../../site-authority/siteAuthorityTestDb");
    return {
      testDb: await createSiteAuthorityTestDb(),
      doGenerate: vi.fn(),
      hosted: { value: true },
      access: { value: { apiKey: "test" } as object },
      spend: vi.fn(async () => ({ status: "unknown" as const })),
    };
  },
);
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
  waitUntil: () => undefined,
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => true,
  isHostedServerAuthMode: async () => hosted.value,
  getWorkersEnv: async () => ({}),
  getOptionalEnvValue: async () => undefined,
}));
vi.mock("@/server/billing/researchSpend", () => ({
  billResearchSpend: spend,
}));
vi.mock("@/server/billing/subscription", () => ({
  checkUsageCreditsDepleted: async () => ({ depleted: false }),
}));
vi.mock("@/server/lib/openrouter", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  return {
    resolveAiAccess: async () => (() => access.value)(),
    buildChatAgentModel: () =>
      new MockLanguageModelV3({ modelId: "test-model", doGenerate }),
  };
});
import { APICallError } from "ai";
import { ContentDraftService } from "./ContentDraftService";
import { ContentReviewService } from "./ContentReviewService";
import { ContentService } from "./ContentService";
import {
  actor,
  EVIDENCE,
  fixture,
  reply,
  SUPPORTED,
} from "../contentDraftTestFixture";

type Request = Awaited<ReturnType<typeof fixture>>["request"];
const generate = (request: Request) =>
  ContentDraftService.generate(
    actor,
    { ...request, confirmedPaidWork: true },
    "authority@example.com",
  );
const head = (contentId: string) =>
  ContentService.getRevision(actor, { projectId: "project", contentId });
const noCost = (answer = reply()) => ({ ...answer, providerMetadata: {} });
const UNKNOWN = { status: "unknown", reason: "cost_not_reported" };
const NO_RESPONSE = { status: "unknown", reason: "no_response" };
const MODEL_FAILED = { status: "failed", reason: "model_failed" };
const statusError = (statusCode: number) =>
  new APICallError({
    message: `Provider answered ${statusCode}`,
    url: "https://provider.invalid/chat",
    requestBodyValues: {},
    statusCode,
  });

beforeEach(async () => {
  await testDb.seedProject();
  doGenerate.mockReset();
  spend.mockClear();
  hosted.value = true;
  access.value = { apiKey: "test" };
});
afterAll(testDb.close);

it("saves nothing from a hosted reply with no cost, and never calls again", async () => {
  const { request } = await fixture();
  doGenerate.mockResolvedValue(noCost());
  expect(await generate(request)).toEqual(UNKNOWN);
  expect(await generate(request)).toEqual(UNKNOWN);
  expect(await ContentDraftService.getRequest(actor, request)).toEqual(UNKNOWN);
  expect(doGenerate).toHaveBeenCalledOnce();
  expect(spend).not.toHaveBeenCalled();
  const read = await head(request.contentId);
  expect(read.revision.version).toBe(2);
  expect(read.revision.markdown).toBe("Earlier text");
});

it("treats a bad hosted reply with no cost the same way", async () => {
  const { request } = await fixture();
  doGenerate.mockResolvedValue(
    noCost(reply([SUPPORTED], { extra: { publish: true } })),
  );
  expect(await generate(request)).toEqual(UNKNOWN);
  expect(spend).not.toHaveBeenCalled();
});

it("frees the content for a new, confirmed request afterwards", async () => {
  const { request } = await fixture();
  doGenerate.mockResolvedValueOnce(noCost());
  await generate(request);
  doGenerate.mockResolvedValueOnce(reply());
  expect(
    await generate({ ...request, requestId: crypto.randomUUID() }),
  ).toMatchObject({ status: "done" });
  expect(spend).toHaveBeenCalledOnce();
});

it.each([true, false])(
  "keeps a request with no reply unknown and unbilled (hosted=%s)",
  async (isHosted) => {
    hosted.value = isHosted;
    const { request } = await fixture();
    doGenerate.mockRejectedValue(new Error("request timed out after dispatch"));
    expect(await generate(request)).toEqual(NO_RESPONSE);
    expect(await generate(request)).toEqual(NO_RESPONSE);
    expect(await ContentDraftService.getRequest(actor, request)).toEqual(
      NO_RESPONSE,
    );
    expect(doGenerate).toHaveBeenCalledOnce();
    expect(spend).not.toHaveBeenCalled();
    const read = await head(request.contentId);
    expect(read.revision.version).toBe(2);
  },
);

it("needs a new confirmed request to run again after no reply", async () => {
  const { request } = await fixture();
  doGenerate.mockRejectedValueOnce(new Error("request timed out"));
  await generate(request);
  doGenerate.mockResolvedValueOnce(reply());
  const again = { ...request, requestId: crypto.randomUUID() };
  expect(await generate(again)).toMatchObject({ status: "done" });
  expect(doGenerate).toHaveBeenCalledTimes(2);
  expect(await ContentDraftService.getRequest(actor, request)).toEqual(
    NO_RESPONSE,
  );
});

it.each([408, 429, 500, 502, 503, 504])(
  "doesn't take a %i from the provider as proof nothing ran",
  async (statusCode) => {
    const { request } = await fixture();
    doGenerate.mockRejectedValue(statusError(statusCode));
    expect(await generate(request)).toEqual(NO_RESPONSE);
    expect(spend).not.toHaveBeenCalled();
  },
);

it.each([401, 402, 403])(
  "reports a provider's %i refusal as a definite failure",
  async (statusCode) => {
    const { request } = await fixture();
    doGenerate.mockRejectedValue(statusError(statusCode));
    expect(await generate(request)).toEqual(MODEL_FAILED);
    expect(await ContentDraftService.getRequest(actor, request)).toEqual(
      MODEL_FAILED,
    );
  },
);

it("doesn't report a subscription run with no reply as an unknown cost", async () => {
  hosted.value = false;
  access.value = {
    subscription: {
      connection: { url: "http://engine.invalid", token: "test" },
      engine: "claude",
      model: "test",
    },
  };
  const { request } = await fixture();
  doGenerate.mockRejectedValue(new Error("request timed out"));
  expect(await generate(request)).toEqual(MODEL_FAILED);
  expect(await ContentDraftService.getRequest(actor, request)).toEqual(
    MODEL_FAILED,
  );
});

it("keeps a draft with no cost where the install pays its own key", async () => {
  hosted.value = false;
  const { request } = await fixture();
  doGenerate.mockResolvedValue(noCost());
  expect(await generate(request)).toMatchObject({ status: "done" });
  const read = await head(request.contentId);
  const note = read.checks.checks.find(
    ({ rule }) => rule === "generated_draft",
  );
  expect(note?.explanation).toContain("Known cost: not reported");
});

it("requires a reviewer to assess uncited text the checks can't read", async () => {
  const { request } = await fixture();
  const text = "Acme ist nach Sicherheitsnorm zertifiziert und kostet nichts.";
  doGenerate.mockResolvedValue(
    reply([{ text, kind: "general", factual: false, citations: [] }]),
  );
  expect(await generate(request)).toMatchObject({ status: "done" });
  const read = await head(request.contentId);
  const [claim] = read.revision.claims;
  expect(claim).toMatchObject({ text, factual: true, evidence: [] });
  expect(read.revision.openQuestions[0]).toContain("Check this draft by hand");
  expect(
    read.checks.checks.find(({ claimId }) => claimId === claim.id),
  ).toMatchObject({ rule: "claim_support", status: "unsupported" });
});

it("refuses to approve a mislabelled sensitive claim as unsupported", async () => {
  const quote = "Acme is HIPAA certified for every plan it sells.";
  const { request } = await fixture(`${EVIDENCE} ${quote}`);
  doGenerate.mockResolvedValue(
    reply([
      {
        text: "Acme is HIPAA certified.",
        kind: "general",
        factual: true,
        citations: [{ source: "S1", quote }],
      },
    ]),
  );
  expect(await generate(request)).toMatchObject({ status: "done" });
  const { revision, checks } = await head(request.contentId);
  expect(revision.claims[0].kind).toBe("legal");
  const review = await ContentReviewService.request(actor, {
    projectId: "project",
    contentId: request.contentId,
    revisionId: revision.id,
    mutationId: crypto.randomUUID(),
    expectedHeadVersion: revision.version,
    expectedContextVersion: revision.contextVersion,
    checkSetId: checks.id,
    assigneeUserId: "user",
  });
  await expect(
    ContentReviewService.decide(actor, {
      projectId: "project",
      contentId: request.contentId,
      requestId: review.id,
      mutationId: crypto.randomUUID(),
      expectedRequestVersion: 0,
      expectedHeadVersion: revision.version,
      decision: "approve",
      claimAssessments: [
        {
          claimId: revision.claims[0].id,
          assessment: "unsupported",
          reason: "Reviewed",
        },
      ],
      assessedRemainingText: true,
      reason: "Reviewed",
    }),
  ).rejects.toThrow("sensitive_claim_unsupported");
});

const cited = (text: string, quote: string) => ({
  text,
  kind: "legal",
  factual: true,
  citations: [{ source: "S1", quote }],
});

describe("citations that say the opposite", () => {
  const HIPAA_YES = "Acme is HIPAA certified for every plan it sells.";
  const HIPAA_NO = "Acme is not HIPAA certified for any plan it sells.";

  it.each([
    ["Acme is HIPAA certified.", HIPAA_NO],
    ["Acme is not HIPAA certified.", HIPAA_YES],
  ])("leaves out and lists %j cited to %j", async (text, quote) => {
    const { request } = await fixture(`${EVIDENCE} ${quote}`);
    doGenerate.mockResolvedValue(reply([SUPPORTED, cited(text, quote)]));
    expect(await generate(request)).toMatchObject({ status: "done" });
    const { revision } = await head(request.contentId);
    expect(revision.markdown).not.toContain(text);
    expect(revision.claims.map((claim) => claim.text)).toEqual([
      SUPPORTED.text,
    ]);
    expect(revision.omissions).toContain(
      `Left out, its source says the opposite: ${text}`,
    );
  });

  it("saves nothing when the only statement is contradicted", async () => {
    const { request } = await fixture(HIPAA_NO);
    doGenerate.mockResolvedValue(
      reply([cited("Acme is HIPAA certified.", HIPAA_NO)]),
    );
    expect(await generate(request)).toEqual({
      status: "failed",
      reason: "no_supported_content",
    });
    expect((await head(request.contentId)).revision.markdown).toBe(
      "Earlier text",
    );
  });

  it("keeps an agreeing negative claim, still for a person to assess", async () => {
    const { request } = await fixture(HIPAA_NO);
    const text = "Acme is not HIPAA certified.";
    doGenerate.mockResolvedValue(reply([cited(text, HIPAA_NO)]));
    expect(await generate(request)).toMatchObject({ status: "done" });
    const { revision, checks } = await head(request.contentId);
    expect(revision.claims[0]).toMatchObject({
      text,
      evidence: [{ excerpt: HIPAA_NO, relation: "supports" }],
    });
    expect(
      checks.checks.find(({ rule }) => rule === "claim_support")?.status,
    ).toBe("not_assessed");
  });
});
