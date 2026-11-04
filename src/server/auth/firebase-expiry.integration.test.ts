import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
const { testDb } = await vi.hoisted(async () => {
  const { createFirebaseTestDb } = await import("./firebase-test-db");
  return { testDb: await createFirebaseTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: testDb.environment,
  waitUntil: () => {},
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/d1/client", () => ({ d1Db: testDb.db }));
vi.mock("@/db/pg/client", () => ({ pgDb: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
import { getAuth } from "@/lib/auth";
import { createFirebaseTestClient } from "./firebase-test-db";
import { createFirebaseTestTokens } from "./firebase-test-tokens";

const { request, cookies } = createFirebaseTestClient((input) =>
  getAuth().handler(input),
);
let fixture: Awaited<ReturnType<typeof createFirebaseTestTokens>>;
const password = "synthetic-owner-password";
beforeAll(async () => {
  fixture = await createFirebaseTestTokens();
});
beforeEach(async () => {
  fixture.mockNetwork();
  await testDb.executeMultiple(
    'delete from apikey; delete from organization; delete from "user";',
  );
  expect(
    (
      await request("/sign-up/email", {
        name: "Owner",
        email: "owner@example.com",
        password,
      })
    ).status,
  ).toBe(200);
  const passwordSignIn = await request("/sign-in/email", {
    email: "owner@example.com",
    password,
  });
  expect(passwordSignIn.status).toBe(200);
  expect(
    (
      await request(
        "/link/firebase",
        { idToken: await fixture.token(), password },
        cookies(passwordSignIn),
      )
    ).status,
  ).toBe(200);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(testDb.close);

it.each([
  ["token", "/api-key/create"],
  ["token", "/sign-in/firebase"],
  ["native session", "/api-key/create"],
])(
  "rejects expired %s at %s after the provider lookup returns",
  async (boundary, path) => {
    const now = Math.floor(Date.now() / 1_000);
    const expiry = now + 60;
    const idToken = await fixture.token({ exp: expiry });
    const google = await request("/sign-in/firebase", { idToken });
    expect(google.status).toBe(200);
    if (boundary === "native session") {
      const deadline =
        testDb.provider === "postgres"
          ? `to_timestamp(${now + 5})`
          : (now + 5) * 1_000;
      await testDb.execute(
        `update session set expires_at=${deadline} where id in (select session_id from firebase_session_proofs)`,
      );
    }
    const upstream = fixture.mockNetwork();
    const realNow = Date.now;
    let lookupReturned = false;
    const clock = vi
      .spyOn(Date, "now")
      .mockImplementation(() =>
        lookupReturned
          ? (boundary === "native session" ? now + 6 : expiry + 1) * 1_000
          : realNow(),
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
      const response = await request(
        path,
        path === "/api-key/create" ? { name: "Denied key" } : { idToken },
        path === "/sign-in/firebase" ? undefined : cookies(google),
      );
      expect(response.status).toBe(401);
      expect(lookupReturned).toBe(true);
      expect(/session_token=[^; ]+/.test(cookies(response))).toBe(false);
      expect(await testDb.execute("select id from apikey")).toHaveLength(0);
      if (path === "/api-key/create") {
        expect(
          await testDb.execute(
            "select session_id from firebase_session_proofs",
          ),
        ).toHaveLength(0);
        expect(await testDb.execute("select id from session")).toHaveLength(1);
      } else {
        expect(await testDb.execute("select id from session")).toHaveLength(2);
        expect(
          await testDb.execute(
            "select session_id from firebase_session_proofs",
          ),
        ).toHaveLength(1);
      }
    } finally {
      clock.mockRestore();
    }
  },
);
