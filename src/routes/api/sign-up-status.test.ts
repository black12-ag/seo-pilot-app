import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const { testDb } = await vi.hoisted(async () => {
  const { createFirebaseTestDb } =
    await import("@/server/auth/firebase-test-db");
  return { testDb: await createFirebaseTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: testDb.environment }));
vi.mock("@/db", () => ({ db: testDb.db }));
import { Route } from "./sign-up-status";
async function status() {
  const handlers = Route.options.server?.handlers;
  if (typeof handlers !== "object" || typeof handlers.GET !== "function")
    throw new Error("Missing status handler");
  const response = await handlers.GET({
    request: new Request("https://seo.example.com/api/sign-up-status"),
    context: undefined,
    params: {},
    pathname: "/api/sign-up-status",
    next: () => {
      throw new Error("Unexpected delegation");
    },
  });
  if (!(response instanceof Response))
    throw new Error("Expected status response");
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json();
}
beforeEach(async () => {
  testDb.environment.FIREBASE_API_KEY = "synthetic-public-api-key";
  await testDb.seedProject();
});
afterAll(testDb.close);
describe("server signup/Google booleans", () => {
  it("reports only booleans from complete server config and current SQL users", async () => {
    expect(await status()).toEqual({ firstAccount: false, googleSignIn: true });
    await testDb.execute('delete from "user"');
    expect(await status()).toEqual({ firstAccount: true, googleSignIn: true });
  });
  it("hides Google with partial configuration while preserving password bootstrap", async () => {
    testDb.environment.FIREBASE_API_KEY = "";
    expect(await status()).toEqual({
      firstAccount: false,
      googleSignIn: false,
    });
  });
});
