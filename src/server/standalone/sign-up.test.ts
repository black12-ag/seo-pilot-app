import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real migration-applied SQLite is established before the policy's static import.
const { client, testDb } = await vi.hoisted(async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const { sort } = await import("remeda");
  const sqliteClient = createClient({ url: "file::memory:" });
  await sqliteClient.execute("PRAGMA foreign_keys=ON");
  for (const file of sort(
    readdirSync("drizzle/sqlite").filter((name) => name.endsWith(".sql")),
    (a, b) => a.localeCompare(b),
  )) {
    await sqliteClient.executeMultiple(
      readFileSync(`drizzle/sqlite/${file}`, "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  return { client: sqliteClient, testDb: drizzle(sqliteClient) };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE_PROVIDER: "d1",
    AUTH_MODE: "password",
    BETTER_AUTH_URL: "https://seo.example.com",
    BETTER_AUTH_SECRET: "synthetic-auth-secret-at-least-32-characters",
    OPENSEO_OPERATOR_SECRET: "test-only-operator-secret-at-least-32-characters",
  },
}));
vi.mock("@/db", () => ({ db: testDb }));
vi.mock("@/db/d1/client", () => ({ d1Db: testDb }));
vi.mock("@/db/pg/client", () => ({ pgDb: testDb }));
import { getAuth, hasBetterAuthConfig } from "@/lib/auth";
import {
  assertStandaloneSignUpOpen,
  isStandaloneSignUpOpen,
} from "@/server/standalone/sign-up";

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM organization;
    DELETE FROM user;
    INSERT INTO user (id,name,email) VALUES ('owner','Owner','owner@example.com');
    INSERT INTO organization (id,name,slug,created_at) VALUES ('org','Org','org',0);
  `);
});
afterAll(() => client.close());

async function invite(status = "pending", expiresAt = Date.now() + 60_000) {
  await client.execute({
    sql: `INSERT INTO invitation
      (id,organization_id,email,role,status,expires_at,inviter_id)
      VALUES ('invite','org','Invitee@Example.com','admin',?,?, 'owner')`,
    args: [status, expiresAt],
  });
}

describe("standalone registration policy through real SQL", () => {
  it("lets the first account through on a fresh installation", async () => {
    await client.execute("DELETE FROM user");
    await expect(isStandaloneSignUpOpen("stranger@example.com")).resolves.toBe(
      true,
    );
  });

  it("rejects an uninvited account after bootstrap", async () => {
    await expect(
      assertStandaloneSignUpOpen(undefined, { email: "stranger@example.com" }),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  it("allows only the email of a current pending invitation", async () => {
    await invite();
    await expect(
      assertStandaloneSignUpOpen(undefined, { email: " invitee@example.com " }),
    ).resolves.toBeUndefined();
    await expect(isStandaloneSignUpOpen("other@example.com")).resolves.toBe(
      false,
    );
  });

  it.each(["canceled", "accepted", "rejected"])(
    "rejects a %s invitation",
    async (status) => {
      await invite(status);
      await expect(isStandaloneSignUpOpen("invitee@example.com")).resolves.toBe(
        false,
      );
    },
  );

  it("rejects an expired pending invitation", async () => {
    await invite("pending", Date.now() - 1_000);
    await expect(isStandaloneSignUpOpen("invitee@example.com")).resolves.toBe(
      false,
    );
  });

  it("rejects a missing email instead of opening registration", async () => {
    await expect(
      assertStandaloneSignUpOpen(undefined, {}),
    ).rejects.toMatchObject({
      status: "FORBIDDEN",
    });
  });

  it("preserves the real operator-secret account-creation exception", async () => {
    await expect(
      assertStandaloneSignUpOpen(
        new Headers({
          "x-openseo-operator-secret":
            "test-only-operator-secret-at-least-32-characters",
        }),
        { email: "operator-created@example.com" },
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertStandaloneSignUpOpen(
        new Headers({ "x-openseo-operator-secret": "wrong" }),
        { email: "operator-created@example.com" },
      ),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
  });
  it("constructs real password auth and creates operator accounts without Firebase or hosted credentials", async () => {
    expect(hasBetterAuthConfig()).toBe(true);
    const auth = getAuth();
    await expect(auth.$context).resolves.toMatchObject({
      options: { socialProviders: {}, emailAndPassword: { enabled: true } },
    });
    const response = await auth.handler(
      new Request("https://seo.example.com/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          origin: "https://seo.example.com",
          "content-type": "application/json",
          "x-openseo-operator-secret":
            "test-only-operator-secret-at-least-32-characters",
        },
        body: JSON.stringify({
          name: "Operator Created",
          email: "operator-created@example.com",
          password: "synthetic-password",
        }),
      }),
    );
    expect(response.status).toBe(200);
  });
});
