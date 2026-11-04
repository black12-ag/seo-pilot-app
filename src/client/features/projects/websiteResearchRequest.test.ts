import { beforeEach, expect, it, vi } from "vitest";
import {
  clearEndedResearchRequest,
  clearRefusedResearchRequest,
  readPendingResearchRequest,
  researchErrorMessage,
  researchRequestIdFor,
} from "./websiteResearchRequest";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
});

it("keeps the request ID when an unexpected error may have followed a paid run", () => {
  const id = researchRequestIdFor("direct", PROJECT_ID, "example.com");
  clearRefusedResearchRequest(
    "direct",
    PROJECT_ID,
    new Error("INTERNAL_ERROR"),
  );
  expect(researchRequestIdFor("direct", PROJECT_ID, "example.com")).toBe(id);
});

it("keeps the request ID when the reply was lost", () => {
  const id = researchRequestIdFor("direct", PROJECT_ID, "example.com");
  clearRefusedResearchRequest(
    "direct",
    PROJECT_ID,
    new Error("Failed to fetch"),
  );
  expect(researchRequestIdFor("direct", PROJECT_ID, "example.com")).toBe(id);
});

it("starts a new request after a specific refusal", () => {
  const id = researchRequestIdFor("direct", PROJECT_ID, "example.com");
  clearRefusedResearchRequest(
    "direct",
    PROJECT_ID,
    new Error("UPSTREAM_UNAVAILABLE"),
  );
  expect(readPendingResearchRequest("direct", PROJECT_ID)).toBeNull();
  expect(researchRequestIdFor("direct", PROJECT_ID, "example.com")).not.toBe(
    id,
  );
});

it("starts a new request once the attempt it names has ended", () => {
  const id = researchRequestIdFor("ai", PROJECT_ID, "");
  clearEndedResearchRequest("ai", PROJECT_ID, id);
  expect(researchRequestIdFor("ai", PROJECT_ID, "")).not.toBe(id);
});

it("keeps a newer request when an older attempt has ended", () => {
  const id = researchRequestIdFor("ai", PROJECT_ID, "");
  clearEndedResearchRequest("ai", PROJECT_ID, crypto.randomUUID());
  expect(researchRequestIdFor("ai", PROJECT_ID, "")).toBe(id);
});

it("names a blocked start instead of blaming the URL", () => {
  expect(researchErrorMessage(new Error("UPSTREAM_UNAVAILABLE"))).toContain(
    "can’t start yet",
  );
  expect(researchErrorMessage(new Error("CONFLICT"))).toContain(
    "Another research run",
  );
  expect(researchErrorMessage(new Error("INTERNAL_ERROR"))).toContain(
    "Check the URL",
  );
});
