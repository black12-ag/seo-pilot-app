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

function importRow(
  table: string,
  values: Record<string, string | number | null>,
) {
  return importCommand({
    command: "rows",
    table,
    columns: Object.keys(values),
    rows: [Object.values(values)],
  });
}

function erasedAttempt() {
  return {
    id: "erased-attempt",
    project_id: "project",
    organization_id: "organization",
    mode: "direct",
    surface: "web",
    sponsor_user_id: null,
    sponsor_member_id: "private-member",
    sponsor_role: "owner",
    request_hash: "private-request-hash",
    admission_token: "old-admission-token",
    execution_token: "old-execution-token",
    requested_website: "https://private.example/path",
    requested_domain: "private.example",
    snapshot_domain: "private-snapshot.example",
    location_code: 2840,
    language_code: "secret-language",
    context_version: 0,
    context_hash: "private-context-hash",
    run_seeded_tracking: 0,
    state: "review_ready",
    active_project_id: null,
    created_at_ms: 1,
    deadline_at_ms: 100,
    finished_at_ms: 2,
    reason: null,
    redacted_at_ms: 3,
    review_snapshot_json: '{"overview":"Private review"}',
    review_hash: "private-review-hash",
    save_token: "old-save-token",
    save_request_hash: "private-save-hash",
    saved_at_ms: 2,
    applied_context_version: 1,
  };
}

function erasedRun() {
  return {
    id: "erased-run",
    project_id: "project",
    organization_id: "organization",
    admission_token: "old-run-token",
    request_id: "private-request",
    request_hash: "private-request-hash",
    origin: "explicit",
    state: "finished",
    outcome: "complete",
    reason: null,
    active_project_id: null,
    sponsor_user_id: null,
    sponsor_member_id: "private-member",
    sponsor_role: "owner",
    surface: "web",
    model_backend_id: "openrouter",
    model_configuration_hash: "private-model-hash",
    domain: "private.example",
    location_code: 2840,
    language_code: "secret-language",
    context_version: 0,
    context_hash: "private-context-hash",
    business_summary: "Private business",
    own_source_url: "https://private.example/path",
    own_source_hash: "private-source-hash",
    own_source_captured_at_ms: 2,
    limits_profile: "competitor-discovery-v1",
    created_at_ms: 1,
    deadline_at_ms: 100,
    finished_at_ms: 2,
    revoked_at_ms: null,
    redacted_at_ms: 3,
    billing_state: "not_started",
    billing_token: "old-billing-token",
    review_mutation_id: "private-review",
    review_token: "old-review-token",
    review_request_hash: "private-review-hash",
    reviewed_by_user_id: null,
  };
}

it("scrubs every private field of a crafted erased attempt before finish", async () => {
  expect(
    (await importRow("project_website_research_attempts", erasedAttempt()))
      .status,
  ).toBe(200);
  expect((await importCommand({ command: "finish" })).status).toBe(200);
  expect(completeImport).toHaveBeenCalledOnce();
  const [row] = (
    await database.execute(
      "select * from project_website_research_attempts where id='erased-attempt'",
    )
  ).rows;
  expect(row).toMatchObject({
    state: "unknown",
    reason: "privacy_erased",
    redacted_at_ms: 3,
    sponsor_member_id: null,
    request_hash: null,
    execution_token: null,
    requested_website: null,
    requested_domain: null,
    snapshot_domain: null,
    language_code: "",
    context_hash: null,
    review_snapshot_json: null,
    review_hash: null,
    save_token: null,
    save_request_hash: null,
    saved_at_ms: null,
    applied_context_version: null,
  });
  expect(row.admission_token).not.toBe("old-admission-token");
});

it("scrubs an erased run and its actual child operation while keeping known cost", async () => {
  expect(
    (await importRow("project_competitor_research_runs", erasedRun())).status,
  ).toBe(200);
  const operation = {
    id: "private-operation",
    project_id: "project",
    run_id: "erased-run",
    slot: "search_0",
    kind: "search",
    state: "succeeded",
    issue_token: "old-issue-token",
    input_hash: "private-input-hash",
    query_text: "private query",
    target_url: "https://private.example/",
    candidate_id: null,
    issued_at_ms: 1,
    finished_at_ms: 2,
    reason: "private reason",
    provider: "dataforseo",
    provider_task_id: "private-task",
    backend_model_id: "private-model",
    usage_basis: "usd",
    cost_usd: 0.03,
    input_tokens: 17,
    output_tokens: 11,
  };
  expect(
    (await importRow("project_competitor_research_operations", operation))
      .status,
  ).toBe(200);
  expect((await importCommand({ command: "finish" })).status).toBe(200);
  expect(completeImport).toHaveBeenCalledOnce();
  const [run] = (
    await database.execute(
      "select * from project_competitor_research_runs where id='erased-run'",
    )
  ).rows;
  expect(run).toMatchObject({
    state: "finished",
    outcome: "blocked",
    reason: "privacy_erased",
    request_hash: "",
    model_backend_id: null,
    model_configuration_hash: "",
    domain: null,
    language_code: "",
    context_hash: "",
    business_summary: "",
    own_source_url: null,
    own_source_hash: null,
    own_source_captured_at_ms: null,
    billing_token: null,
    review_mutation_id: null,
    review_token: null,
    review_request_hash: null,
  });
  expect(run.admission_token).not.toBe("old-run-token");
  const [stored] = (
    await database.execute(
      "select * from project_competitor_research_operations where id='private-operation'",
    )
  ).rows;
  expect(stored).toMatchObject({
    input_hash: null,
    query_text: null,
    target_url: null,
    candidate_id: null,
    reason: null,
    provider: null,
    provider_task_id: null,
    backend_model_id: null,
    input_tokens: null,
    output_tokens: null,
    cost_usd: 0.03,
  });
  expect(stored.issue_token).not.toBe("old-issue-token");
});

it("rejects a candidate under an actually erased same-project run", async () => {
  expect(
    (await importRow("project_competitor_research_runs", erasedRun())).status,
  ).toBe(200);
  expect(
    (
      await importRow("project_competitor_research_candidates", {
        id: "private-candidate",
        project_id: "project",
        run_id: "erased-run",
        domain: "private.example",
        rank_order: 0,
        classification: "verified",
        canonical_competitor_id: null,
        source_url: "https://private.example/",
        source_excerpt: "Private evidence",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await database.execute(
        "select id from project_competitor_research_candidates",
      )
    ).rows,
  ).toHaveLength(0);
  expect(completeImport).not.toHaveBeenCalled();
});

it("finish catches SQL-tampered erased residue and NULL reason before KV completion", async () => {
  expect(
    (await importRow("project_website_research_attempts", erasedAttempt()))
      .status,
  ).toBe(200);
  await database.execute(
    "update project_website_research_attempts set snapshot_domain='private.example',reason=null where id='erased-attempt'",
  );
  expect((await importCommand({ command: "finish" })).status).toBe(409);
  expect(completeImport).not.toHaveBeenCalled();
});

it("finish rejects a tampered erased run and operation without completing import", async () => {
  expect(
    (await importRow("project_competitor_research_runs", erasedRun())).status,
  ).toBe(200);
  expect(
    (
      await importRow("project_competitor_research_operations", {
        id: "operation",
        project_id: "project",
        run_id: "erased-run",
        slot: "own_page",
        kind: "page",
        state: "prepared",
        issued_at_ms: null,
        finished_at_ms: null,
        issue_token: null,
        input_hash: "private-input",
        target_url: "https://private.example/",
        usage_basis: "unknown",
      })
    ).status,
  ).toBe(200);
  await database.execute(
    "update project_competitor_research_operations set target_url='https://private.example/' where id='operation'",
  );
  expect((await importCommand({ command: "finish" })).status).toBe(409);
  expect(completeImport).not.toHaveBeenCalled();
  await database.execute(
    "update project_competitor_research_operations set target_url=null where id='operation'",
  );
  await database.execute(
    "update project_competitor_research_runs set domain='private.example' where id='erased-run'",
  );
  expect((await importCommand({ command: "finish" })).status).toBe(409);
  expect(completeImport).not.toHaveBeenCalled();
});

it("accepts omitted nullable private attempt columns only when DB defaults are safe", async () => {
  const {
    snapshot_domain: _domain,
    context_hash: _hash,
    ...withoutOptional
  } = erasedAttempt();
  expect(
    (await importRow("project_website_research_attempts", withoutOptional))
      .status,
  ).toBe(200);
  expect((await importCommand({ command: "finish" })).status).toBe(200);
  expect(completeImport).toHaveBeenCalledOnce();
});
