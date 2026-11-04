import { afterAll, beforeEach, expect, it, vi } from "vitest";

const {
  database,
  prepareQuery,
  runImportBatch,
  operatorSecret,
  completeImport,
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
        const row = (await client.execute(statement)).rows[0];
        return column ? (row?.[column] ?? null) : (row ?? null);
      },
    };
  }
  return {
    database: client,
    prepareQuery: prepare,
    runImportBatch: async (queries: Array<ReturnType<typeof prepare>>) =>
      client.batch(
        queries.map((query) => query.statement),
        "write",
      ),
    operatorSecret: "test-only-import-secret-that-is-long-enough",
    completeImport: vi.fn(),
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    OPENSEO_OPERATOR_SECRET: operatorSecret,
    DB: { prepare: prepareQuery },
    KV: { get: async () => "active-import", put: completeImport },
  },
}));
vi.mock("@/db/runBatch", () => ({ runD1ImportBatch: runImportBatch }));
vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
import { handleImport } from "./import";

afterAll(() => database.close());
beforeEach(async () => {
  await database.executeMultiple(`delete from organization; delete from "user";
    insert into organization(id,name,slug,created_at) values('organization','Org','org',0);
    insert into projects(id,organization_id,name,domain) values('project','organization','Project','example.com');`);
});

function importCommand(body: unknown) {
  return handleImport(
    new Request("https://local.test/operator/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openseo-operator-secret": operatorSecret,
      },
      body: JSON.stringify(body),
    }),
  );
}

it("imports completed competitor evidence without restoring sponsor authority", async () => {
  await database.execute(
    "insert into user (id,name,email) values ('sponsor','Sponsor','sponsor@example.com')",
  );
  await database.execute(
    "insert into project_competitors (id,project_id,domain,name,updated_by) values ('canonical','project','rival.com','Rival','user')",
  );
  const run = {
    id: "run",
    project_id: "project",
    organization_id: "organization",
    admission_token: "nonce",
    request_id: "request",
    request_hash: "private-hash",
    origin: "setup",
    state: "finished",
    outcome: "complete",
    reason: null,
    active_project_id: null,
    sponsor_user_id: "sponsor",
    sponsor_member_id: "member",
    sponsor_role: "owner",
    surface: "web",
    model_configuration_hash: "model-hash",
    domain: "example.com",
    location_code: 2840,
    language_code: "en",
    context_version: 0,
    context_hash: "context-hash",
    business_summary: "Business",
    created_at_ms: 1,
    deadline_at_ms: 100,
    finished_at_ms: 2,
    billing_state: "not_started",
    billing_token: null,
    review_mutation_id: "review",
    review_token: "review-token",
    review_request_hash: "review-hash",
    reviewed_by_user_id: "sponsor",
    revoked_at_ms: null,
    redacted_at_ms: null,
  };
  expect(
    (
      await importCommand({
        command: "rows",
        table: "project_competitor_research_runs",
        columns: Object.keys(run),
        rows: [Object.values(run)],
      })
    ).status,
  ).toBe(200);
  const candidate = {
    id: "candidate",
    project_id: "project",
    run_id: "run",
    domain: "rival.com",
    rank_order: 0,
    classification: "verified",
    source_url: "https://rival.com/",
    source_excerpt: "Evidence",
    canonical_competitor_id: "canonical",
  };
  expect(
    (
      await importCommand({
        command: "rows",
        table: "project_competitor_research_candidates",
        columns: Object.keys(candidate),
        rows: [Object.values(candidate)],
      })
    ).status,
  ).toBe(200);
  expect((await importCommand({ command: "finish" })).status).toBe(200);
  expect(
    (
      await database.execute(
        "select reason,sponsor_user_id,sponsor_member_id,review_token,request_hash from project_competitor_research_runs where id='run'",
      )
    ).rows,
  ).toMatchObject([
    {
      reason: "restored",
      sponsor_user_id: null,
      sponsor_member_id: null,
      review_token: null,
      request_hash: "",
    },
  ]);
  expect(
    (
      await database.execute(
        "select source_url,canonical_competitor_id from project_competitor_research_candidates where id='candidate'",
      )
    ).rows,
  ).toMatchObject([
    {
      source_url: "https://rival.com/",
      canonical_competitor_id: "canonical",
    },
  ]);
});

it("refuses to finish a crafted competitor link to another project's canonical row", async () => {
  await database.execute(
    "insert into projects (id,organization_id,name,domain) values ('other-project','organization','Other','other.com')",
  );
  await database.execute(
    "insert into project_competitors (id,project_id,domain,name,updated_by) values ('foreign-canonical','other-project','rival.com','Rival','user')",
  );
  await database.execute(
    "insert into project_competitor_research_runs (id,project_id,organization_id,admission_token,request_id,request_hash,origin,state,outcome,reason,surface,model_configuration_hash,domain,location_code,language_code,context_version,context_hash,business_summary,created_at_ms,deadline_at_ms,finished_at_ms,billing_state) values ('run','project','organization','nonce','request','','setup','finished','complete','restored','web','modelhash','example.com',2840,'en',0,'hash','Business',1,100,2,'not_started')",
  );
  const candidate = {
    id: "candidate",
    project_id: "project",
    run_id: "run",
    domain: "rival.com",
    rank_order: 0,
    classification: "verified",
    canonical_competitor_id: "foreign-canonical",
  };
  expect(
    (
      await importCommand({
        command: "rows",
        table: "project_competitor_research_candidates",
        columns: Object.keys(candidate),
        rows: [Object.values(candidate)],
      })
    ).status,
  ).toBe(200);
  expect((await importCommand({ command: "finish" })).status).toBe(409);
});

it("terminalizes a crafted active setup attempt without a sponsor or execution token", async () => {
  const attempt = {
    id: "attempt",
    project_id: "project",
    organization_id: "organization",
    mode: "ai_setup",
    surface: "web",
    sponsor_user_id: null,
    sponsor_member_id: "old-member",
    sponsor_role: "owner",
    request_hash: "private-hash",
    admission_token: "old-nonce",
    execution_token: null,
    requested_website: "https://example.com/",
    requested_domain: "example.com",
    snapshot_domain: "example.com",
    location_code: 2840,
    language_code: "en",
    context_version: 0,
    context_hash: "context-hash",
    run_seeded_tracking: 1,
    state: "admitted",
    active_project_id: "project",
    created_at_ms: 1,
    deadline_at_ms: 100,
    finished_at_ms: null,
    reason: null,
    redacted_at_ms: null,
    review_snapshot_json: null,
    review_hash: null,
    save_token: null,
    save_request_hash: null,
    saved_at_ms: null,
    applied_context_version: null,
  };
  expect(
    (
      await importCommand({
        command: "rows",
        table: "project_website_research_attempts",
        columns: Object.keys(attempt),
        rows: [Object.values(attempt)],
      })
    ).status,
  ).toBe(200);
  expect((await importCommand({ command: "finish" })).status).toBe(200);
  expect(
    (
      await database.execute(
        "select state,reason,active_project_id,sponsor_member_id,execution_token from project_website_research_attempts where id='attempt'",
      )
    ).rows,
  ).toMatchObject([
    {
      state: "unknown",
      reason: "restored",
      active_project_id: null,
      sponsor_member_id: null,
      execution_token: null,
    },
  ]);
});

it("rejects an issued paid operation from a crafted portable archive", async () => {
  const response = await importCommand({
    command: "rows",
    table: "project_competitor_research_operations",
    columns: [
      "id",
      "project_id",
      "run_id",
      "slot",
      "kind",
      "state",
      "issued_at_ms",
      "finished_at_ms",
      "issue_token",
      "usage_basis",
    ],
    rows: [
      [
        "operation",
        "project",
        "run",
        "search_0",
        "search",
        "issued",
        2,
        null,
        "old-token",
        "unknown",
      ],
    ],
  });
  expect(response.status).toBe(400);
  expect(
    (
      await database.execute(
        "select id from project_competitor_research_operations",
      )
    ).rows,
  ).toHaveLength(0);
});

it("clears an unneeded erased legacy issue token and rejects its reintroduction at finish", async () => {
  await database.execute(
    "insert into project_competitor_research_runs (id,project_id,organization_id,admission_token,request_id,request_hash,origin,state,outcome,reason,surface,model_configuration_hash,location_code,language_code,context_version,context_hash,business_summary,created_at_ms,deadline_at_ms,finished_at_ms,redacted_at_ms,billing_state) values ('erased-run','project','organization','opaque','request','','setup','finished','blocked','privacy_erased','web','',2840,'',0,'','',1,100,2,3,'not_started')",
  );
  const operation = {
    id: "erased-operation",
    project_id: "project",
    run_id: "erased-run",
    slot: "setup_evidence",
    kind: "legacy",
    state: "succeeded",
    issued_at_ms: null,
    finished_at_ms: 2,
    issue_token: "stale-private-token",
    input_hash: "private-input",
    usage_basis: "unknown",
    cost_usd: 0.03,
  };
  expect(
    (
      await importCommand({
        command: "rows",
        table: "project_competitor_research_operations",
        columns: Object.keys(operation),
        rows: [Object.values(operation)],
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await database.execute(
        "select issue_token,input_hash,cost_usd from project_competitor_research_operations where id='erased-operation'",
      )
    ).rows,
  ).toMatchObject([{ issue_token: null, input_hash: null, cost_usd: 0.03 }]);
  await database.execute(
    "update project_competitor_research_operations set issue_token='tampered-token' where id='erased-operation'",
  );
  expect((await importCommand({ command: "finish" })).status).toBe(409);
  expect(completeImport).not.toHaveBeenCalled();
  await database.execute(
    "update project_competitor_research_operations set issue_token=null where id='erased-operation'",
  );
  expect((await importCommand({ command: "finish" })).status).toBe(200);
  expect(completeImport).toHaveBeenCalledOnce();
});
