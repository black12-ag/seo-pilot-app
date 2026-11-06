import { z } from "zod";
import { getAgentByName } from "agents";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const {
  client: database,
  prepare: prepareQuery,
  executeBatch: runImportBatch,
  operatorSecret,
} = await vi.hoisted(async () => {
  const { createClient } = await import("@libsql/client");
  const { sort } = await import("remeda");
  const { readdirSync, readFileSync } = await import("node:fs");
  const client = createClient({ url: "file::memory:" });
  await client.execute("PRAGMA foreign_keys=ON");
  for (const file of sort(
    readdirSync("drizzle/sqlite").filter((name) => name.endsWith(".sql")),
    (a, b) => a.localeCompare(b),
  )) {
    await client.executeMultiple(
      readFileSync(`drizzle/sqlite/${file}`, "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  function prepare(sql: string) {
    const statement = { sql, args: [] as Array<string | number | null> };
    return {
      statement,
      bind(...args: Array<string | number | null>) {
        statement.args = args;
        return this;
      },
      async all() {
        return { results: (await client.execute(statement)).rows };
      },
      async first(column?: string) {
        const result = (await client.execute(statement)).rows[0];
        return column ? (result?.[column] ?? null) : (result ?? null);
      },
    };
  }
  const executeBatch = async (
    statements: Array<ReturnType<typeof prepare>>,
  ) => {
    await client.batch(
      statements.map((query) => query.statement),
      "write",
    );
  };
  return {
    client,
    prepare,
    executeBatch,
    operatorSecret: "fixture-import-operator-secret-only",
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    SEO_PILOT_OPERATOR_SECRET: operatorSecret,
    DB: { prepare: prepareQuery },
    KV: { get: async () => "active-import", put: vi.fn() },
  },
}));
vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
vi.mock("@/db/runBatch", () => ({ runD1ImportBatch: runImportBatch }));
import { handleImport } from "./import";
afterAll(() => database.close());
beforeEach(async () => {
  await database.executeMultiple(`delete from organization; delete from "user";
    insert into organization(id,name,slug,created_at) values('organization','Org','org',0);
    insert into projects(id,organization_id,name,domain) values('project','organization','Project','example.com');`);
});
const columns = [
  "project_id",
  "organization_id",
  "version",
  "state",
  "start_url",
  "cadence",
  "time_zone",
  "hour",
  "minute",
  "max_pages",
  "render_javascript",
  "lighthouse_strategy",
  "max_cost_micros_per_run",
  "max_cost_micros_per_utc_day",
  "max_pages_per_utc_day",
  "max_runs_per_utc_day",
  "estimate_fingerprint",
  "policy_fingerprint",
  "next_due_at_ms",
  "updated_at_ms",
  "mutation_token",
];
const row = [
  "project",
  "organization",
  4,
  "enabled",
  "https://example.com",
  "daily",
  "UTC",
  6,
  0,
  10,
  0,
  "none",
  0,
  0,
  10,
  1,
  "a",
  "b",
  1800000000000,
  1,
  "token",
];
function request(inputColumns = columns, rows = [row]) {
  return new Request("https://local.test/operator/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-seo-pilot-operator-secret": operatorSecret,
    },
    body: JSON.stringify({
      command: "rows",
      table: "audit_schedules",
      columns: inputColumns,
      rows,
    }),
  });
}
describe("protected recurring schedule restore", () => {
  it("imports a paused revision with no due instant and cannot reenable on replay", async () => {
    expect((await handleImport(request())).status).toBe(200);
    expect((await handleImport(request())).status).toBe(200);
    expect(
      (
        await database.execute(
          "select state,version,next_due_at_ms from audit_schedules",
        )
      ).rows,
    ).toEqual([
      expect.objectContaining({
        state: "paused",
        version: 5,
        next_due_at_ms: null,
      }),
    ]);
  });
  it("rejects partial schedule columns and invalid version before writing", async () => {
    expect(
      (
        await handleImport(
          request(["project_id", "state"], [["project", "enabled"]]),
        )
      ).status,
    ).toBe(400);
    const invalid = [...row];
    invalid[2] = "4";
    expect((await handleImport(request(columns, [invalid]))).status).toBe(400);
    expect(
      (await database.execute("select * from audit_schedules")).rows,
    ).toHaveLength(0);
  });
  it("never accepts an unauthenticated import", async () => {
    const req = request();
    req.headers.delete("x-seo-pilot-operator-secret");
    expect((await handleImport(req)).status).toBe(404);
  });
});

describe("URL source restore", () => {
  it("imports exact URL provenance with the source and project foreign keys", async () => {
    await database.executeMultiple(`
      INSERT INTO content_mutations VALUES ('receipt','project','mutation','hash','capture','source',1,1);
      INSERT INTO content_sources (id,project_id,mutation_receipt_id,kind,title,attribution,source_text,text_hash,captured_at_ms,extraction_method,extraction_version,extraction_status) VALUES ('source','project','receipt','web','Title','example.com','Text','hash',1,'public_html_text','public-source-v1','usable');
    `);
    const req = new Request("https://local.test/operator/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-seo-pilot-operator-secret": operatorSecret,
      },
      body: JSON.stringify({
        command: "rows",
        table: "content_source_url_captures",
        columns: [
          "source_id",
          "project_id",
          "requested_url",
          "resolved_url",
          "http_status",
          "redirect_count",
          "fetch_attempted",
          "response_complete",
          "text_truncated",
          "extracted_bytes",
        ],
        rows: [
          [
            "source",
            "project",
            "https://example.com/?q=private",
            "https://example.com/final",
            200,
            1,
            1,
            1,
            0,
            4,
          ],
        ],
      }),
    });
    expect((await handleImport(req)).status).toBe(200);
    expect(
      (
        await database.execute(
          "select requested_url,resolved_url from content_source_url_captures",
        )
      ).rows,
    ).toMatchObject([
      {
        requested_url: "https://example.com/?q=private",
        resolved_url: "https://example.com/final",
      },
    ]);
  });
});

function importCommand(body: unknown) {
  return handleImport(
    new Request("https://local.test/operator/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-seo-pilot-operator-secret": operatorSecret,
      },
      body: JSON.stringify(body),
    }),
  );
}
const identityColumns = [
  "firebase_project_id",
  "firebase_uid",
  "user_id",
  "created_at_ms",
];
async function restoreUser() {
  const response = await importCommand({
    command: "rows",
    table: "user",
    columns: ["id", "name", "email"],
    rows: [["restored-user", "Restored User", "restored@example.com"]],
  });
  expect(response.status).toBe(200);
}
describe("Firebase portable restore", () => {
  it.each(["rows", "sam"])(
    "rejects proof credentials from a direct operator %s upload",
    async (command) => {
      if (command === "sam") {
        await restoreUser();
        await database.execute(
          "insert into sam_sessions (id,project_id,user_id) values ('conversation','project','restored-user')",
        );
      }
      const payload = crypto.randomUUID();
      const response = await importCommand({
        command,
        sessionId: "conversation",
        table: "firebase_session_proofs",
        columns: ["session_id", "encrypted_proof"],
        rows: [["session", payload]],
      });
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toBe("Unknown or excluded table");
      expect(text.includes(payload)).toBe(false);
      expect(getAgentByName).not.toHaveBeenCalled();
      expect(
        (
          await database.execute(
            "select session_id from firebase_session_proofs",
          )
        ).rows,
      ).toHaveLength(0);
    },
  );
  it("refuses a sealed site password from a direct operator upload", async () => {
    const response = await importCommand({
      command: "rows",
      table: "wordpress_connections",
      columns: ["project_id", "sealed_credential"],
      rows: [["project", "sealed"]],
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Unknown or excluded table");
  });

  it("restores historical identity only after its user and never mints session or membership", async () => {
    const body = {
      command: "rows",
      table: "firebase_identities",
      columns: identityColumns,
      rows: [["firebase-project", "historical-uid", "restored-user", 1]],
    };
    await expect(importCommand(body)).rejects.toThrow();
    expect(
      (await database.execute("select user_id from firebase_identities")).rows,
    ).toHaveLength(0);
    await restoreUser();
    expect((await importCommand(body)).status).toBe(200);
    expect((await importCommand(body)).status).toBe(200);
    expect(
      (await database.execute("select user_id from firebase_identities")).rows,
    ).toEqual([{ user_id: "restored-user" }]);
    for (const table of ["session", "firebase_session_proofs", "member"])
      expect(
        (await database.execute(`select * from ${table}`)).rows,
      ).toHaveLength(0);
    const authority = await importCommand({
      ...body,
      columns: [...identityColumns, "role"],
      rows: [["firebase-project", "other-uid", "restored-user", 1, "owner"]],
    });
    expect(authority.status).toBe(400);
  });
  it("omits proof counts while keeping the portable manifest count contract and existing session count", async () => {
    await restoreUser();
    expect(
      (
        await importCommand({
          command: "rows",
          table: "firebase_identities",
          columns: identityColumns,
          rows: [["firebase-project", "uid", "restored-user", 1]],
        })
      ).status,
    ).toBe(200);
    await database.executeMultiple(
      "insert into session (id,token,user_id,expires_at,created_at,updated_at) values ('session','fixture-session-token','restored-user',1,1,1);",
    );
    const payload = crypto.randomUUID();
    await database.execute({
      sql: "insert into firebase_session_proofs (session_id,user_id,firebase_project_id,firebase_uid,encrypted_proof,auth_time_seconds,token_expires_at_ms,created_at_ms) values ('session','restored-user','firebase-project','uid',?,1,1000,1)",
      args: [payload],
    });
    const response = await importCommand({ command: "counts" });
    const text = await response.text();
    expect(text.includes(payload)).toBe(false);
    const counts = z.record(z.string(), z.number()).parse(JSON.parse(text));
    expect(counts).not.toHaveProperty("firebase_session_proofs");
    expect(counts.session).toBe(1);
    const manifest = {
      tables: [
        { table: "user", count: 1 },
        { table: "firebase_identities", count: 1 },
      ],
    };
    for (const entry of manifest.tables)
      expect(counts[entry.table]).toBe(entry.count);
  });
});
