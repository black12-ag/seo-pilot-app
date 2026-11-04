import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { createSiteAuthorityTestDb } from "../../src/server/features/site-authority/siteAuthorityTestDb";

const run = promisify(execFile);
const seedSnapshot = `
const { dirname } = require('node:path');
const { readFile } = require('node:fs/promises');
(async () => {
const { Miniflare, convertV4MiniflareOptions } = require(require.resolve('miniflare', { paths: [dirname(require.resolve('wrangler'))] }));
const mf = new Miniflare(convertV4MiniflareOptions({
  name: 'open-seo', modules: true, compatibilityDate: '2025-09-02',
  script: "export default { fetch() { return new Response('Synthetic offline fixture'); } };",
  d1Databases: { DB: process.env.LEGACY_D1_ID }, r2Buckets: { R2: 'open-seo' },
  resourcePersistencePath: process.env.RETENTION_SNAPSHOT,
}));
try {
  const db = await mf.getD1Database('DB');
  for (const sql of JSON.parse(await readFile(process.env.RETENTION_SCHEMA, 'utf8'))) await db.prepare(sql).run();
  await db.prepare("insert into user (id,name,email) values ('user','Synthetic User','fixture@example.com')").run();
  await db.prepare("insert into organization (id,name,slug,created_at) values ('organization','Fixture','fixture',0)").run();
  await db.prepare("insert into projects (id,organization_id,name,domain) values ('project','organization','Fixture','example.com')").run();
  await db.prepare("insert into firebase_identities (firebase_project_id,firebase_uid,user_id,created_at_ms) values ('fixture-project','fixture-uid','user',1)").run();
  await db.prepare("insert into session (id,token,user_id,expires_at,created_at,updated_at) values ('session','synthetic-session','user',1,1,1)").run();
  await db.prepare("insert into firebase_session_proofs (session_id,user_id,firebase_project_id,firebase_uid,encrypted_proof,auth_time_seconds,token_expires_at_ms,created_at_ms) values ('session','user','fixture-project','fixture-uid',?,1,1000,1)").bind(process.env.RETENTION_PROOF).run();
  await db.prepare("insert into account (id,account_id,provider_id,user_id,password,created_at,updated_at) values ('credential','user','credential','user','synthetic-hash',1,1)").run();
  await db.prepare("insert into wordpress_connections (project_id,origin,credential_id,sealed_credential,read_status,write_status,created_at_ms,updated_at_ms) values ('project','https://example.com','credential',?,'granted','granted',1,1)").bind(process.env.RETENTION_PROOF).run();
  if (process.env.RETENTION_UNCERTAIN_DRAFT === '1') {
    await db.prepare("insert into content_mutations (id,project_id,mutation_id,request_hash,kind,result_id,completed,created_at_ms) values ('receipt','project','create','hash','revision','revision',1,1)").run();
    await db.prepare("insert into content_items (id,project_id,head_version,created_at_ms,updated_at_ms) values ('content','project',1,1,1)").run();
    await db.prepare("insert into content_revisions (id,project_id,content_id,version,mutation_receipt_id,brief_json,markdown,metadata_json,context_json,context_version,context_hash,source_set_hash,content_hash,open_questions_json,omissions_json,surface,created_at_ms) values ('revision','project','content',1,'receipt','{}','','{}','{}',0,'c','s','h','[]','[]','web',1)").run();
    await db.prepare("insert into wordpress_publish_records (id,project_id,content_id,revision_id,idempotency_key,origin,title,slug,content_hash,state,attempt,last_attempt_at_ms,created_at_ms,updated_at_ms) values ('record','project','content','revision','key','https://example.com','Title','title','hash','uncertain',1,1,1,1)").run();
  }
  if (process.env.RETENTION_ACTIVE_COMPETITOR === '1')
    await db.prepare("insert into project_competitor_research_runs (id,project_id,organization_id,admission_token,request_id,request_hash,origin,state,active_project_id,surface,model_configuration_hash,domain,location_code,language_code,context_version,context_hash,business_summary,limits_profile,created_at_ms,deadline_at_ms,billing_state) values ('active','project','organization','nonce','request','hash','explicit','queued','project','web','modelhash','example.com',2840,'en',0,'contexthash','Business','competitor-discovery-v1',1,1000,'not_started')").run();
} finally { await mf.dispose(); }
})().catch(error => { process.stderr.write(error.message); process.exitCode = 1; });
`;

it("exports the actual offline snapshot with user-ordered identities and no session proofs", async () => {
  const fixture = await createSiteAuthorityTestDb();
  const directory = await mkdtemp(join(tmpdir(), "seo-retention-export-"));
  const payload = crypto.randomUUID();
  try {
    if (fixture.provider !== "d1")
      throw new Error("Export fixture requires isolated SQLite");
    const schema = z
      .array(z.object({ sql: z.string() }))
      .parse(
        await fixture.execute(
          "select sql from sqlite_schema where sql is not null and name not like 'sqlite_%' and type in ('table','index') order by case type when 'table' then 0 else 1 end, rowid",
        ),
      );
    const schemaPath = join(directory, "schema.json");
    await writeFile(
      schemaPath,
      JSON.stringify(schema.map((entry) => entry.sql)),
      { mode: 0o600 },
    );
    const snapshot = join(directory, "snapshot");
    const output = join(directory, "export");
    const environment = {
      ...process.env,
      LEGACY_D1_ID: "11111111-1111-4111-8111-111111111111",
      RETENTION_SCHEMA: schemaPath,
      RETENTION_SNAPSHOT: snapshot,
      RETENTION_PROOF: payload,
    };
    await run(process.execPath, ["-e", seedSnapshot], {
      env: environment,
      timeout: 60_000,
    });
    const result = await run(
      process.execPath,
      ["scripts/celld/export-legacy.mjs", snapshot, output],
      { env: environment, timeout: 60_000 },
    );
    expect(result.stdout.includes(payload)).toBe(false);
    expect(result.stderr.includes(payload)).toBe(false);
    expect((await stat(output)).mode & 0o777).toBe(0o700);
    const manifest = z
      .object({
        tables: z.array(
          z.object({ table: z.string(), file: z.string(), count: z.number() }),
        ),
        omitted: z.array(z.string()),
      })
      .parse(JSON.parse(await readFile(join(output, "manifest.json"), "utf8")));
    const tables = manifest.tables.map((entry) => entry.table);
    expect(tables).not.toContain("session");
    expect(tables).not.toContain("firebase_session_proofs");
    expect(tables).not.toContain("wordpress_connections");
    expect(
      manifest.omitted.some((entry) => entry.includes("WordPress connections")),
    ).toBe(true);
    expect(tables.indexOf("firebase_identities")).toBeGreaterThan(
      tables.indexOf("user"),
    );
    expect(
      manifest.omitted.some((entry) =>
        entry.includes("Firebase session proofs"),
      ),
    ).toBe(true);
    const identityEntry = manifest.tables.find(
      (entry) => entry.table === "firebase_identities",
    );
    if (!identityEntry) throw new Error("Identity mapping was not exported");
    const identity = z
      .object({
        columns: z.array(z.string()),
        rows: z.array(z.array(z.unknown())),
      })
      .parse(
        JSON.parse(await readFile(join(output, identityEntry.file), "utf8")),
      );
    expect(identity.rows).toEqual([
      ["fixture-project", "fixture-uid", "user", 1],
    ]);
    for (const file of await readdir(output)) {
      expect((await stat(join(output, file))).mode & 0o777).toBe(0o600);
      expect(
        (await readFile(join(output, file), "utf8")).includes(payload),
      ).toBe(false);
    }
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

it("refuses a portable export with an active competitor run before writing chunks", async () => {
  const fixture = await createSiteAuthorityTestDb();
  const directory = await mkdtemp(
    join(tmpdir(), "seo-active-competitor-export-"),
  );
  try {
    if (fixture.provider !== "d1")
      throw new Error("Export fixture requires isolated SQLite");
    const schema = z
      .array(z.object({ sql: z.string() }))
      .parse(
        await fixture.execute(
          "select sql from sqlite_schema where sql is not null and name not like 'sqlite_%' and type in ('table','index') order by case type when 'table' then 0 else 1 end, rowid",
        ),
      );
    const schemaPath = join(directory, "schema.json");
    await writeFile(
      schemaPath,
      JSON.stringify(schema.map((entry) => entry.sql)),
      {
        mode: 0o600,
      },
    );
    const snapshot = join(directory, "snapshot");
    const output = join(directory, "export");
    const environment = {
      ...process.env,
      LEGACY_D1_ID: "11111111-1111-4111-8111-111111111111",
      RETENTION_SCHEMA: schemaPath,
      RETENTION_SNAPSHOT: snapshot,
      RETENTION_PROOF: "test-only-proof",
      RETENTION_ACTIVE_COMPETITOR: "1",
    };
    await run(process.execPath, ["-e", seedSnapshot], {
      env: environment,
      timeout: 60_000,
    });
    await expect(
      run(
        process.execPath,
        ["scripts/celld/export-legacy.mjs", snapshot, output],
        {
          env: environment,
          timeout: 60_000,
        },
      ),
    ).rejects.toThrow(
      "Finish or reconcile active and uncertain competitor research",
    );
    expect(await readdir(output)).toEqual([]);
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

it("refuses to export while a WordPress draft is still uncertain", async () => {
  const fixture = await createSiteAuthorityTestDb();
  const directory = await mkdtemp(join(tmpdir(), "seo-retention-export-"));
  try {
    if (fixture.provider !== "d1")
      throw new Error("Export fixture requires isolated SQLite");
    const schema = z
      .array(z.object({ sql: z.string() }))
      .parse(
        await fixture.execute(
          "select sql from sqlite_schema where sql is not null and name not like 'sqlite_%' and type in ('table','index') order by case type when 'table' then 0 else 1 end, rowid",
        ),
      );
    const schemaPath = join(directory, "schema.json");
    await writeFile(
      schemaPath,
      JSON.stringify(schema.map((entry) => entry.sql)),
      { mode: 0o600 },
    );
    const snapshot = join(directory, "snapshot");
    const output = join(directory, "export");
    const environment = {
      ...process.env,
      LEGACY_D1_ID: "11111111-1111-4111-8111-111111111111",
      RETENTION_SCHEMA: schemaPath,
      RETENTION_SNAPSHOT: snapshot,
      RETENTION_PROOF: "test-only-proof",
      RETENTION_UNCERTAIN_DRAFT: "1",
    };
    await run(process.execPath, ["-e", seedSnapshot], {
      env: environment,
      timeout: 60_000,
    });
    await expect(
      run(
        process.execPath,
        ["scripts/celld/export-legacy.mjs", snapshot, output],
        { env: environment, timeout: 60_000 },
      ),
    ).rejects.toThrow("Check every uncertain WordPress draft");
    expect(await readdir(output)).toEqual([]);
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
