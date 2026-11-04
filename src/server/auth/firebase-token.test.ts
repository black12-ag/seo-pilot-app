import { decodeJwt, SignJWT } from "jose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createFirebaseTestTokens } from "./firebase-test-tokens";
import { verifyFirebaseToken } from "./firebase-token";

vi.mock("cloudflare:workers", () => ({ env: {} }));
let fixture: Awaited<ReturnType<typeof createFirebaseTestTokens>>;
const config = {
  projectId: "test-firebase",
  apiKey: "synthetic-key",
  authDomain: "test-firebase.firebaseapp.com",
  appId: "synthetic-app",
};
beforeAll(async () => {
  fixture = await createFirebaseTestTokens();
});
beforeEach(() => {
  fixture.mockNetwork();
});
afterEach(() => vi.unstubAllGlobals());

describe("Firebase signature and current-account verification", () => {
  it("accepts a signed verified identity with omitted default status fields", async () => {
    expect(
      await verifyFirebaseToken(await fixture.token(), config),
    ).toMatchObject({
      firebaseUid: "firebase-owner",
      email: "owner@example.com",
    });
  });
  it.each([
    { aud: "another-project" },
    { iss: "https://accounts.google.com" },
    { sub: "" },
    { email_verified: false },
    { firebase: { sign_in_provider: "password" } },
    { firebase: { sign_in_provider: "google.com", tenant: "other" } },
    { iat: 9_000_000_000 },
    { exp: 1 },
  ])("rejects invalid identity claims %j", async (claims) => {
    await expect(
      verifyFirebaseToken(await fixture.token(claims), config),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });
  it.each([
    { disabled: true },
    { disabled: "false" },
    { validSince: "123junk" },
    { validSince: "-1" },
    { validSince: String(Math.floor(Date.now() / 1_000) + 60) },
    { localId: "someone-else" },
    { emailVerified: false },
    { email: "other@example.com" },
  ])("rejects invalid or revoked account status %j", async (status) => {
    fixture.mockNetwork(status);
    await expect(
      verifyFirebaseToken(await fixture.token(), config),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });
  it("does not expose a token or provider payload on failure", async () => {
    const token = await fixture.token();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(token)));
    await expect(verifyFirebaseToken(token, config)).rejects.toMatchObject({
      message: "Google identity could not be verified. Please sign in again.",
    });
  });
  it("rejects an unknown signing kid before account lookup", async () => {
    const other = await createFirebaseTestTokens();
    await expect(
      verifyFirebaseToken(await other.token(), config),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });
  it("rejects a tampered RS256 signature", async () => {
    const segments = (await fixture.token()).split(".");
    segments[2] = (segments[2][0] === "A" ? "B" : "A") + segments[2].slice(1);
    await expect(
      verifyFirebaseToken(segments.join("."), config),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });
  it("rejects another valid JWT algorithm despite otherwise valid Firebase claims", async () => {
    const token = await new SignJWT(decodeJwt(await fixture.token()))
      .setProtectedHeader({ alg: "HS256", kid: "synthetic-hmac" })
      .sign(new Uint8Array(32));
    await expect(verifyFirebaseToken(token, config)).rejects.toMatchObject({
      status: "UNAUTHORIZED",
    });
  });
  it("rejects a token expiring while its status lookup is in flight", async () => {
    const expiry = Math.floor(Date.now() / 1_000) + 60;
    const token = await fixture.token({ exp: expiry });
    const upstream = fixture.mockNetwork();
    const realNow = Date.now;
    let lookupReturned = false;
    const clock = vi
      .spyOn(Date, "now")
      .mockImplementation(() =>
        lookupReturned ? (expiry + 1) * 1_000 : realNow(),
      );
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await upstream(input, init);
        const url = input instanceof Request ? input.url : input.toString();
        if (url.includes("/v1/accounts:lookup")) lookupReturned = true;
        return response;
      },
    );
    try {
      await expect(verifyFirebaseToken(token, config)).rejects.toMatchObject({
        status: "UNAUTHORIZED",
      });
      expect(lookupReturned).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
});
