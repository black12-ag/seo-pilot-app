import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
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
import { getAuth, hasBetterAuthConfig } from "@/lib/auth";
import { createFirebaseTestClient } from "./firebase-test-db";
import { createFirebaseTestTokens } from "./firebase-test-tokens";
import { FirebaseIdentityRepository as repository } from "./repositories/FirebaseIdentityRepository";
import { resolveHostedContext } from "@/middleware/ensure-user/hosted";

let fixture: Awaited<ReturnType<typeof createFirebaseTestTokens>>;
let ownerCookie: string;
let ownerId: string;
let orgId: string;
const password = "synthetic-owner-password";
const { request, cookies } = createFirebaseTestClient((input) =>
  getAuth().handler(input),
);
async function signInGoogle(overrides = {}) {
  const token = await fixture.token(overrides);
  const response = await request("/sign-in/firebase", { idToken: token });
  return { response, token, cookie: cookies(response) };
}
async function linkOwner() {
  const response = await request(
    "/link/firebase",
    { idToken: await fixture.token(), password },
    ownerCookie,
  );
  expect(response.status).toBe(200);
}
async function invite(email = "invitee@example.com") {
  await testDb.executeMultiple(`INSERT INTO invitation
    (id,organization_id,email,role,status,expires_at,inviter_id)
    VALUES ('invite','${orgId}','${email}','admin','pending',${testDb.provider === "postgres" ? "now()+interval '1 hour'" : Date.now() + 3_600_000},'${ownerId}');`);
}

beforeAll(async () => {
  fixture = await createFirebaseTestTokens();
});
beforeEach(async () => {
  testDb.environment.FIREBASE_API_KEY = "synthetic-public-api-key";
  fixture.mockNetwork();
  await testDb.executeMultiple(
    'DELETE FROM apikey; DELETE FROM organization; DELETE FROM "user";',
  );
  const signup = await request("/sign-up/email", {
    name: "Local Owner",
    email: "owner@example.com",
    password,
  });
  expect(signup.status).toBe(200);
  ownerId = z
    .object({ user: z.object({ id: z.string() }) })
    .parse(await signup.json()).user.id;
  const signedIn = await request("/sign-in/email", {
    email: "owner@example.com",
    password,
  });
  expect(signedIn.status).toBe(200);
  ownerCookie = cookies(signedIn);
  orgId = z
    .object({ id: z.string() })
    .parse((await testDb.execute("select id from organization"))[0]).id;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(testDb.close);

describe(`Firebase public auth boundaries (${testDb.provider})`, () => {
  it("keeps password startup/login with absent or partial Firebase configuration", async () => {
    testDb.environment.FIREBASE_API_KEY = "";
    expect(hasBetterAuthConfig()).toBe(true);
    expect(
      (
        await request("/sign-in/email", {
          email: "owner@example.com",
          password,
        })
      ).status,
    ).toBe(200);
    expect(
      (await request("/sign-in/firebase", { idToken: "unconfigured" })).status,
    ).toBe(404);
  });
  it("requires explicit password linking and preserves the owner identity/workspace/password", async () => {
    expect((await signInGoogle()).response.status).toBe(409);
    const wrong = await request(
      "/link/firebase",
      { idToken: await fixture.token(), password: "incorrect" },
      ownerCookie,
    );
    expect(wrong.status).not.toBe(200);
    await linkOwner();
    const google = await signInGoogle();
    expect(google.response.status).toBe(200);
    expect(await google.response.json()).toEqual({ status: "ok" });
    const context = await resolveHostedContext(
      new Headers({ cookie: google.cookie }),
    );
    expect(context).toMatchObject({
      userId: ownerId,
      organizationId: orgId,
      role: "owner",
    });
    expect(await testDb.execute('select id,name from "user"')).toEqual([
      expect.objectContaining({ id: ownerId, name: "Local Owner" }),
    ]);
    expect(await testDb.execute("select provider_id from account")).toEqual([
      expect.objectContaining({ provider_id: "credential" }),
    ]);
    const proof = (
      await testDb.execute(
        "select encrypted_proof from firebase_session_proofs",
      )
    )[0];
    expect(JSON.stringify(proof)).not.toContain(google.token);
    const session = await request("/get-session", undefined, google.cookie);
    expect(session.status).toBe(200);
    expect(await session.text()).not.toContain(google.token);
    expect(
      (
        await request("/sign-in/email", {
          email: "owner@example.com",
          password,
        })
      ).status,
    ).toBe(200);
  });
  it("rejects unsafe origin, missing origin, unknown authority fields and wrong methods", async () => {
    const token = await fixture.token();
    expect(
      (
        await request(
          "/sign-in/firebase",
          { idToken: token },
          undefined,
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    expect(
      (await request("/sign-in/firebase", { idToken: token }, undefined, ""))
        .status,
    ).toBe(403);
    expect(
      (
        await request("/sign-in/firebase", {
          idToken: token,
          userId: ownerId,
          role: "owner",
        })
      ).status,
    ).toBe(400);
    expect((await request("/sign-in/firebase")).status).not.toBe(200);
  });
  it("never grants an uninvited or first Firebase user a session/workspace", async () => {
    const claims = { sub: "unknown", email: "unknown@example.com" };
    expect((await signInGoogle(claims)).response.status).toBe(403);
    await testDb.executeMultiple(
      'DELETE FROM apikey; DELETE FROM organization; DELETE FROM "user";',
    );
    const denied = await signInGoogle(claims);
    expect(denied.response.status).toBe(403);
    expect(denied.cookie).not.toContain("session_token");
    expect(await testDb.execute('select id from "user"')).toHaveLength(0);
    expect(await testDb.execute("select id from organization")).toHaveLength(0);
  });
  it("keeps an invited identity out of default-org/app fallback after cancellation", async () => {
    await invite();
    const google = await signInGoogle({
      sub: "invitee",
      email: "invitee@example.com",
    });
    expect(google.response.status).toBe(200);
    await testDb.execute("update invitation set status='canceled'");
    await expect(
      resolveHostedContext(new Headers({ cookie: google.cookie })),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await testDb.execute("select id from organization")).toHaveLength(1);
    const session = await request("/get-session", undefined, google.cookie);
    expect(
      z
        .object({ session: z.object({ activeOrganizationId: z.null() }) })
        .parse(await session.json()).session.activeOrganizationId,
    ).toBeNull();
  });
  it("resolves later changed Google emails by UID without replacing local email", async () => {
    await linkOwner();
    const google = await signInGoogle({ email: "changed@example.com" });
    expect(google.response.status).toBe(200);
    expect(
      (await repository.findIdentity("test-firebase", "firebase-owner"))?.user
        .email,
    ).toBe("owner@example.com");
  });
  it.each(["/get-session", "/list-sessions", "/organization/list"])(
    "revokes disabled identity before raw %s can return data",
    async (path) => {
      await linkOwner();
      const google = await signInGoogle();
      fixture.mockNetwork({ disabled: true });
      const denied = await request(path, undefined, google.cookie);
      expect(denied.status).toBe(401);
      expect(
        await testDb.execute("select session_id from firebase_session_proofs"),
      ).toHaveLength(0);
    },
  );
  it("keeps near-expiry sessions bounded through application, native and API-key reads", async () => {
    await linkOwner();
    const now = Math.floor(Date.now() / 1_000);
    const google = await signInGoogle({
      iat: now - 3_500,
      auth_time: now - 3_500,
      exp: now + 30,
    });
    expect(google.response.status).toBe(200);
    const before = await testDb.execute(
      "select expires_at from session where id in (select session_id from firebase_session_proofs)",
    );
    expect(
      (await request("/get-session", undefined, google.cookie)).status,
    ).toBe(200);
    expect(
      (await request("/organization/list", undefined, google.cookie)).status,
    ).toBe(200);
    expect(
      (
        await request(
          "/api-key/create",
          { name: "Synthetic key" },
          google.cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await getAuth().api.getSession({
          headers: new Headers({ cookie: google.cookie }),
        })
      )?.user.id,
    ).toBe(ownerId);
    await resolveHostedContext(new Headers({ cookie: google.cookie }));
    const post = await request("/get-session", {}, google.cookie);
    expect([200, 404, 405]).toContain(post.status);
    expect(
      await testDb.execute(
        "select expires_at from session where id in (select session_id from firebase_session_proofs)",
      ),
    ).toEqual(before);
  });
  it("rolls back invited provisioning when the invitation disappears under its lock", async () => {
    await invite();
    testDb.beforeNextBatch(async () => {
      await testDb.execute("update invitation set status='canceled'");
    });
    expect(
      (await signInGoogle({ sub: "invitee", email: "invitee@example.com" }))
        .response.status,
    ).toBe(403);
    expect(await testDb.execute('select id from "user"')).toHaveLength(1);
    expect(
      await testDb.execute("select firebase_uid from firebase_identities"),
    ).toHaveLength(0);
  });
  it("rejects a proof whose relational owner is changed to another valid user", async () => {
    await linkOwner();
    const google = await signInGoogle();
    await invite();
    const invitee = await signInGoogle({
      sub: "invitee",
      email: "invitee@example.com",
    });
    expect(invitee.response.status).toBe(200);
    await testDb.execute(
      "update firebase_session_proofs set user_id=(select user_id from firebase_identities where firebase_uid='invitee') where firebase_uid='firebase-owner'",
    );
    expect(
      (await request("/get-session", undefined, google.cookie)).status,
    ).toBe(401);
  });
  it("rechecks a revoked identity before API-key or application access", async () => {
    await linkOwner();
    const google = await signInGoogle();
    fixture.mockNetwork({
      validSince: String(Math.floor(Date.now() / 1_000) + 1),
    });
    expect(
      (await request("/api-key/create", { name: "Denied key" }, google.cookie))
        .status,
    ).toBe(401);
    await expect(
      resolveHostedContext(new Headers({ cookie: google.cookie })),
    ).rejects.toBeTruthy();
    expect(await testDb.execute("select id from apikey")).toHaveLength(0);
  });
  it("does not issue a cookie when durable proof storage fails", async () => {
    await linkOwner();
    const pg = testDb.provider === "postgres";
    await testDb.executeMultiple(
      pg
        ? "create function reject_firebase_proof() returns trigger language plpgsql as $$ begin raise exception 'synthetic proof failure'; end $$; create trigger reject_firebase_proof before insert on firebase_session_proofs for each row execute function reject_firebase_proof();"
        : "create trigger reject_firebase_proof before insert on firebase_session_proofs begin select raise(abort, 'synthetic proof failure'); end;",
    );
    try {
      const google = await signInGoogle();
      expect(google.response.status).toBe(500);
      expect(google.cookie).not.toContain("session_token");
      expect(
        await testDb.execute("select session_id from firebase_session_proofs"),
      ).toHaveLength(0);
      expect(await testDb.execute("select id from session")).toHaveLength(1);
    } finally {
      await testDb.executeMultiple(
        pg
          ? "drop trigger reject_firebase_proof on firebase_session_proofs; drop function reject_firebase_proof();"
          : "drop trigger reject_firebase_proof;",
      );
    }
  });
  it("cannot revive an expired proof through the public native session endpoint", async () => {
    await linkOwner();
    const now = Math.floor(Date.now() / 1_000);
    const google = await signInGoogle({ exp: now + 5 });
    expect(google.response.status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((now + 10) * 1_000);
    try {
      const expired = await request("/get-session", undefined, google.cookie);
      expect(await expired.json()).toBeNull();
      expect(
        await testDb.execute("select session_id from firebase_session_proofs"),
      ).toHaveLength(0);
      await expect(
        resolveHostedContext(new Headers({ cookie: google.cookie })),
      ).rejects.toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects ciphertext swapped from another valid session", async () => {
    await linkOwner();
    const original = await signInGoogle();
    const other = await signInGoogle();
    const shape = z.object({ session: z.object({ id: z.string() }) });
    const originalId = shape.parse(
      await (await request("/get-session", undefined, original.cookie)).json(),
    ).session.id;
    const otherId = shape.parse(
      await (await request("/get-session", undefined, other.cookie)).json(),
    ).session.id;
    await testDb.execute(
      `update firebase_session_proofs set encrypted_proof=(select encrypted_proof from firebase_session_proofs where session_id='${otherId}') where session_id='${originalId}'`,
    );
    expect(
      (await request("/get-session", undefined, original.cookie)).status,
    ).toBe(401);
    expect(
      (await request("/get-session", undefined, other.cookie)).status,
    ).toBe(200);
  });
  it.each([
    { email: "different@example.com" },
    { auth_time: Math.floor(Date.now() / 1_000) - 301 },
  ])("rejects an unintended or stale owner link %j", async (claims) => {
    const response = await request(
      "/link/firebase",
      { idToken: await fixture.token(claims), password },
      ownerCookie,
    );
    expect(response.status).toBe(403);
    expect(
      await testDb.execute("select user_id from firebase_identities"),
    ).toHaveLength(0);
  });
});
