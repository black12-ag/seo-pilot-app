type Cell = string | number | null;
type RowInput = { table: string; columns: string[]; rows: Cell[][] };

const erasedRunNull = [
  "sponsor_user_id",
  "sponsor_member_id",
  "sponsor_role",
  "model_backend_id",
  "domain",
  "own_source_url",
  "own_source_hash",
  "own_source_captured_at_ms",
  "billing_token",
  "review_mutation_id",
  "review_token",
  "review_request_hash",
  "reviewed_by_user_id",
] as const;
const erasedRunBlank = [
  "request_hash",
  "model_configuration_hash",
  "language_code",
  "context_hash",
  "business_summary",
] as const;
const erasedAttemptNull = [
  "sponsor_user_id",
  "sponsor_member_id",
  "sponsor_role",
  "request_hash",
  "execution_token",
  "requested_website",
  "requested_domain",
  "snapshot_domain",
  "context_hash",
  "review_snapshot_json",
  "review_hash",
  "save_token",
  "save_request_hash",
  "saved_at_ms",
  "applied_context_version",
] as const;
const erasedOperationNull = [
  "input_hash",
  "query_text",
  "target_url",
  "candidate_id",
  "reason",
  "provider",
  "provider_task_id",
  "backend_model_id",
  "input_tokens",
  "output_tokens",
] as const;

const required: Record<string, string[]> = {
  project_competitor_research_runs: [
    "state",
    "outcome",
    "reason",
    "active_project_id",
    "sponsor_user_id",
    "sponsor_member_id",
    "sponsor_role",
    "admission_token",
    "request_hash",
    "review_mutation_id",
    "review_token",
    "review_request_hash",
    "reviewed_by_user_id",
    "billing_state",
    "billing_token",
    "finished_at_ms",
    "revoked_at_ms",
    "redacted_at_ms",
  ],
  project_competitor_research_operations: [
    "project_id",
    "run_id",
    "state",
    "kind",
    "issued_at_ms",
    "finished_at_ms",
    "issue_token",
  ],
  project_competitor_research_candidates: [
    "id",
    "project_id",
    "run_id",
    "domain",
    "canonical_competitor_id",
  ],
  project_website_research_attempts: [
    "state",
    "reason",
    "active_project_id",
    "sponsor_user_id",
    "sponsor_member_id",
    "sponsor_role",
    "admission_token",
    "request_hash",
    "execution_token",
    "save_token",
    "save_request_hash",
    "saved_at_ms",
    "applied_context_version",
    "review_snapshot_json",
    "review_hash",
    "finished_at_ms",
    "redacted_at_ms",
  ],
};

export async function prepareCompetitorHistory(
  input: RowInput,
  db: D1Database,
): Promise<RowInput> {
  const fields = required[input.table];
  if (!fields) return input;
  if (fields.some((name) => !input.columns.includes(name)))
    throw new Error("Competitor history columns are incomplete");
  const rows = [];
  for (const original of input.rows) {
    const row = [...original];
    const get = (name: string) => row[input.columns.indexOf(name)];
    const set = (name: string, value: Cell) => {
      const index = input.columns.indexOf(name);
      if (index >= 0) row[index] = value;
    };
    const now = Date.now();
    if (input.table === "project_competitor_research_runs") {
      if (["started", "unknown"].includes(String(get("billing_state"))))
        throw new Error("Unsettled competitor billing cannot be imported");
      const erased = get("redacted_at_ms") !== null;
      const active = ["queued", "running"].includes(String(get("state")));
      set("state", "finished");
      if (active) set("outcome", "blocked");
      set("reason", erased ? "privacy_erased" : "restored");
      set("active_project_id", null);
      set("finished_at_ms", get("finished_at_ms") ?? now);
      set("revoked_at_ms", get("revoked_at_ms") ?? now);
      set("sponsor_user_id", null);
      set("sponsor_member_id", null);
      set("sponsor_role", null);
      set("admission_token", crypto.randomUUID());
      set("request_hash", "");
      set("review_mutation_id", null);
      set("review_token", null);
      set("review_request_hash", null);
      set("reviewed_by_user_id", null);
      set("billing_token", null);
      if (erased) {
        set("outcome", "blocked");
        for (const name of erasedRunNull) set(name, null);
        for (const name of erasedRunBlank) set(name, "");
      }
    } else if (input.table === "project_competitor_research_operations") {
      const parent = await db
        .prepare(
          "select redacted_at_ms from project_competitor_research_runs where id=? and project_id=?",
        )
        .bind(get("run_id"), get("project_id"))
        .first<{ redacted_at_ms: number | null }>();
      if (!parent) throw new Error("Competitor operation parent is missing");
      const erased = parent.redacted_at_ms !== null;
      if (
        ["issued", "unknown"].includes(String(get("state"))) &&
        ["search", "model"].includes(String(get("kind"))) &&
        !erased
      )
        throw new Error(
          "Unresolved paid competitor operation cannot be imported",
        );
      if (get("state") === "issued") {
        set("state", "unknown");
        set("finished_at_ms", now);
        set("issue_token", crypto.randomUUID());
      }
      if (erased) {
        for (const name of erasedOperationNull) set(name, null);
        set(
          "issue_token",
          get("issued_at_ms") === null ? null : crypto.randomUUID(),
        );
      }
    } else if (input.table === "project_competitor_research_candidates") {
      const parent = await db
        .prepare(
          "select redacted_at_ms from project_competitor_research_runs where id=? and project_id=?",
        )
        .bind(get("run_id"), get("project_id"))
        .first<{ redacted_at_ms: number | null }>();
      if (!parent || parent.redacted_at_ms !== null)
        throw new Error("Competitor candidate parent is unavailable");
    } else if (input.table === "project_website_research_attempts") {
      const erased = get("redacted_at_ms") !== null;
      const active = ["admitted", "running"].includes(String(get("state")));
      if (active) set("state", "unknown");
      set("reason", erased ? "privacy_erased" : "restored");
      set("active_project_id", null);
      if (active) set("finished_at_ms", now);
      set("sponsor_user_id", null);
      set("sponsor_member_id", null);
      set("sponsor_role", null);
      set("admission_token", crypto.randomUUID());
      set("request_hash", null);
      set("execution_token", null);
      set("save_token", null);
      set("save_request_hash", null);
      set("saved_at_ms", null);
      set("applied_context_version", null);
      if (erased) {
        set("state", "unknown");
        for (const name of erasedAttemptNull) set(name, null);
        set("language_code", "");
        set("snapshot_domain", null);
        set("context_hash", null);
      }
    }
    rows.push(row);
  }
  return { ...input, rows };
}

async function assertCompetitorHistoryFinished(db: D1Database) {
  const runPrivate = [
    ...erasedRunNull.map((name) => `r.${name} is not null`),
    ...erasedRunBlank.map((name) => `coalesce(r.${name},'') <> ''`),
  ].join(" or ");
  const attemptPrivate = [
    ...erasedAttemptNull.map((name) => `a.${name} is not null`),
    "coalesce(a.language_code,'') <> ''",
  ].join(" or ");
  const operationPrivate = erasedOperationNull
    .map((name) => `o.${name} is not null`)
    .join(" or ");
  const checks = [
    `select count(*) n from project_competitor_research_runs r where r.active_project_id is not null or r.state <> 'finished' or r.sponsor_user_id is not null or r.sponsor_member_id is not null or r.sponsor_role is not null or r.billing_state in ('started','unknown') or r.billing_token is not null or r.review_token is not null or r.review_request_hash is not null or r.request_hash <> '' or (r.redacted_at_ms is null and coalesce(r.reason,'') <> 'restored') or (r.redacted_at_ms is not null and (coalesce(r.reason,'') <> 'privacy_erased' or ${runPrivate}))`,
    `select count(*) n from project_website_research_attempts a where a.active_project_id is not null or a.state in ('admitted','running') or a.sponsor_user_id is not null or a.sponsor_member_id is not null or a.sponsor_role is not null or a.execution_token is not null or a.save_token is not null or a.save_request_hash is not null or a.request_hash is not null or (a.redacted_at_ms is null and coalesce(a.reason,'') <> 'restored') or (a.redacted_at_ms is not null and (coalesce(a.reason,'') <> 'privacy_erased' or ${attemptPrivate}))`,
    `select count(*) n from project_competitor_research_operations o join project_competitor_research_runs r on r.id=o.run_id and r.project_id=o.project_id where o.state='issued' or (o.state='unknown' and o.kind in ('search','model') and r.redacted_at_ms is null) or (r.redacted_at_ms is not null and (${operationPrivate} or (o.issued_at_ms is null and o.issue_token is not null)))`,
    `select count(*) n from project_competitor_research_candidates c join project_competitors p on p.id=c.canonical_competitor_id where p.project_id<>c.project_id or p.domain<>c.domain`,
    `select count(*) n from project_competitor_research_operations o left join project_competitor_research_candidates c on c.id=o.candidate_id where o.candidate_id is not null and (c.id is null or c.project_id<>o.project_id or c.run_id<>o.run_id)`,
    `select count(*) n from project_competitor_research_candidates c join project_competitor_research_runs r on r.id=c.run_id where r.redacted_at_ms is not null`,
  ];
  for (const query of checks) {
    if ((await db.prepare(query).first<number>("n")) !== 0)
      throw new Error("Imported competitor history is not inert");
  }
}

export async function finishCompetitorImport(
  db: D1Database,
  kv: KVNamespace,
  marker: string,
  state: string,
): Promise<Response> {
  try {
    await assertCompetitorHistoryFinished(db);
  } catch {
    return new Response("Imported competitor history is not inert", {
      status: 409,
    });
  }
  await kv.put(marker, `complete:${state}`);
  return Response.json({ ok: true });
}
