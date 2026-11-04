import { beforeEach, describe, expect, it, vi } from "vitest";
const { environment } = vi.hoisted(() => ({
  environment: {
    AUTH_MODE: "password",
    FIREBASE_PROJECT_ID: "test-firebase",
    FIREBASE_AUTH_DOMAIN: "test-firebase.firebaseapp.com",
    FIREBASE_API_KEY: "public-key",
    FIREBASE_APP_ID: "public-app",
  },
}));
vi.mock("cloudflare:workers", () => ({ env: environment }));
import { Route } from "./firebase-config";

async function response() {
  const handlers = Route.options.server?.handlers;
  if (typeof handlers !== "object" || typeof handlers.GET !== "function")
    throw new Error("Missing config handler");
  const result = await handlers.GET({
    request: new Request("https://seo.example.com/api/firebase-config"),
    context: undefined,
    params: {},
    pathname: "/api/firebase-config",
    next: () => {
      throw new Error("Unexpected delegation");
    },
  });
  if (!(result instanceof Response))
    throw new Error("Expected public config response");
  return result;
}
beforeEach(() => {
  environment.AUTH_MODE = "password";
  environment.FIREBASE_API_KEY = "public-key";
});
describe("public Firebase capability", () => {
  it("returns only complete public browser fields without caching", async () => {
    const result = await response();
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({
      config: {
        projectId: "test-firebase",
        authDomain: "test-firebase.firebaseapp.com",
        apiKey: "public-key",
        appId: "public-app",
      },
    });
  });
  it("returns unavailable on partial config without breaking password startup", async () => {
    environment.FIREBASE_API_KEY = "";
    expect(await (await response()).json()).toEqual({ config: null });
  });
  it.each(["hosted", "everyapp", "local_noauth", "cloudflare_access"])(
    "does not expose standalone Firebase in %s",
    async (mode) => {
      environment.AUTH_MODE = mode;
      expect(await (await response()).json()).toEqual({ config: null });
    },
  );
});
