import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
const { testDb } = await vi.hoisted(async () => {
  const { createFirebaseTestDb } =
    await import("@/server/auth/firebase-test-db");
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
import { createFirebaseTestClient } from "@/server/auth/firebase-test-db";
import { createFirebaseTestTokens } from "@/server/auth/firebase-test-tokens";
import { resolveHostedContext } from "./hosted";

const { request, cookies } = createFirebaseTestClient((input) =>
  getAuth().handler(input),
);
let tokens: Awaited<ReturnType<typeof createFirebaseTestTokens>>;
let ownerCookie: string;
let ownerId: string;
let orgId: string;
const password = "synthetic-owner-password";
beforeAll(async () => {
  tokens = await createFirebaseTestTokens();
});
beforeEach(async () => {
  tokens.mockNetwork();
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
  const signedIn = await request("/sign-in/email", {
    email: "owner@example.com",
    password,
  });
  expect(signedIn.status).toBe(200);
  ownerCookie = cookies(signedIn);
  const context = await resolveHostedContext(
    new Headers({ cookie: ownerCookie }),
  );
  ownerId = context.userId;
  orgId = context.organizationId;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(testDb.close);

it("permits identity-only invitation acceptance and grants only the inviter's membership", async () => {
  const invited = await request(
    "/organization/invite-member",
    { email: "invitee@example.com", role: "admin", organizationId: orgId },
    ownerCookie,
  );
  expect(invited.status).toBe(200);
  const invitationId = z
    .object({ id: z.string() })
    .parse(await invited.json()).id;
  const google = await request("/sign-in/firebase", {
    idToken: await tokens.token({
      sub: "invitee",
      email: "invitee@example.com",
    }),
  });
  expect(google.status).toBe(200);
  const cookie = cookies(google);
  await expect(
    resolveHostedContext(new Headers({ cookie })),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  const accepted = await request(
    "/organization/accept-invitation",
    { invitationId },
    cookie,
  );
  expect(accepted.status).toBe(200);
  expect(await resolveHostedContext(new Headers({ cookie }))).toMatchObject({
    organizationId: orgId,
    role: "admin",
  });
  expect(await testDb.execute("select id from organization")).toHaveLength(1);
});
it("never repairs a removed Firebase membership by creating a new workspace", async () => {
  expect(
    (
      await request(
        "/link/firebase",
        { idToken: await tokens.token(), password },
        ownerCookie,
      )
    ).status,
  ).toBe(200);
  const google = await request("/sign-in/firebase", {
    idToken: await tokens.token(),
  });
  expect(google.status).toBe(200);
  await testDb.execute(`delete from member where user_id='${ownerId}'`);
  await expect(
    resolveHostedContext(new Headers({ cookie: cookies(google) })),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(
    (await request("/sign-in/firebase", { idToken: await tokens.token() }))
      .status,
  ).toBe(200);
  expect(await testDb.execute("select id from organization")).toHaveLength(1);
});
