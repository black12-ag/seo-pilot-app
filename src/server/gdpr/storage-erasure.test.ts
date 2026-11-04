import { expect, it, vi } from "vitest";

const captureServerError = vi.hoisted(() => vi.fn());
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/posthog", () => ({ captureServerError }));

import {
  gdprStorageErasurePayloadSchema,
  signGdprErasureRequest,
} from "@/shared/gdpr-erasure";
import { handleGdprStorageErasure } from "./storage-erasure";

it("blocks erasure when an active AI Workflow cannot be classified as stopped", async () => {
  const payload = gdprStorageErasurePayloadSchema.parse({
    userId: "user",
    email: "user@example.com",
    organizationIds: [],
    samSessionIds: [],
    auditIds: [],
    activeAuditWorkflowIds: [],
    activeRankWorkflowIds: [],
    activeAiVisibilityWorkflowIds: ["competitor-research-run"],
    activeLocalRankWorkflowIds: [],
    aiVisibilityProjectIds: [],
    r2Keys: [],
    googleAccounts: [],
  });
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const secret = "test-only-erasure-secret";
  const request = new Request(
    "https://example.com/api/internal/gdpr-erasure/storage",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(body).byteLength),
        "x-gdpr-timestamp": timestamp,
        "x-gdpr-signature": await signGdprErasureRequest(
          secret,
          timestamp,
          body,
        ),
      },
      body,
    },
  );
  const get = vi.fn().mockRejectedValue(new Error("engine unavailable"));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test env holds only the bindings this path reads
  const env = {
    GDPR_ERASURE_SECRET: secret,
    SITE_AUDIT_WORKFLOW: { get: vi.fn() },
    RANK_CHECK_WORKFLOW: { get: vi.fn() },
    AI_VISIBILITY_WORKFLOW: { get },
    LOCAL_RANK_WORKFLOW: { get: vi.fn() },
  } as unknown as Env;
  const result = await handleGdprStorageErasure(request, env);
  expect(result.status).toBe(500);
  expect(get).toHaveBeenCalledExactlyOnceWith("competitor-research-run");
  expect(captureServerError).toHaveBeenCalledOnce();
});

it("accepts a known completed Workflow without calling terminate", async () => {
  const payload = gdprStorageErasurePayloadSchema.parse({
    userId: "user",
    email: "user@example.com",
    organizationIds: [],
    samSessionIds: [],
    auditIds: [],
    activeAuditWorkflowIds: [],
    activeRankWorkflowIds: [],
    activeAiVisibilityWorkflowIds: ["competitor-research-run"],
    activeLocalRankWorkflowIds: [],
    aiVisibilityProjectIds: [],
    r2Keys: [],
    googleAccounts: [],
  });
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const secret = "test-only-erasure-secret";
  const terminate = vi.fn();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test env holds only the bindings this path reads
  const env = {
    GDPR_ERASURE_SECRET: secret,
    SITE_AUDIT_WORKFLOW: { get: vi.fn() },
    RANK_CHECK_WORKFLOW: { get: vi.fn() },
    AI_VISIBILITY_WORKFLOW: {
      get: vi.fn().mockResolvedValue({
        status: async () => ({ status: "complete" }),
        terminate,
      }),
    },
    LOCAL_RANK_WORKFLOW: { get: vi.fn() },
    KV: { delete: vi.fn() },
    R2: { list: async () => ({ objects: [], truncated: false }) },
    OAUTH_KV: { list: async () => ({ keys: [], list_complete: true }) },
  } as unknown as Env;
  const result = await handleGdprStorageErasure(
    new Request("https://example.com/api/internal/gdpr-erasure/storage", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(body).byteLength),
        "x-gdpr-timestamp": timestamp,
        "x-gdpr-signature": await signGdprErasureRequest(
          secret,
          timestamp,
          body,
        ),
      },
      body,
    }),
    env,
  );
  expect(result.status).toBe(200);
  expect(terminate).not.toHaveBeenCalled();
});
