import { afterAll, expect, it, vi } from "vitest";

const {
  database: testDb,
  prepare: prepareQuery,
  runImportBatch: executeImportBatch,
} = await vi.hoisted(async () => {
  const { createClient } = await import("@libsql/client");
  const { readdirSync, readFileSync } = await import("node:fs");
  const { sort } = await import("remeda");
  const database = createClient({ url: "file::memory:" });
  await database.execute("PRAGMA foreign_keys=ON");
  for (const file of sort(
    readdirSync("drizzle/sqlite").filter((name) => name.endsWith(".sql")),
    (a, b) => a.localeCompare(b),
  ))
    await database.executeMultiple(
      readFileSync(`drizzle/sqlite/${file}`, "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  function prepare(sql: string) {
    const statement = { sql, args: [] as Array<string | number | null> };
    return {
      statement,
      bind(...args: Array<string | number | null>) {
        statement.args = args;
        return this;
      },
      async all() {
        return { results: (await database.execute(statement)).rows };
      },
      async first(column?: string) {
        const row = (await database.execute(statement)).rows[0];
        return column ? (row?.[column] ?? null) : (row ?? null);
      },
    };
  }
  const runImportBatch = async (
    statements: Array<ReturnType<typeof prepare>>,
  ) => {
    await database.batch(
      statements.map((query) => query.statement),
      "write",
    );
  };
  return { database, prepare, runImportBatch };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    OPENSEO_OPERATOR_SECRET: "fixture-import-operator-secret-only",
    DB: { prepare: prepareQuery },
    KV: { get: async () => "active-import" },
  },
}));
vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
vi.mock("@/db/runBatch", () => ({ runD1ImportBatch: executeImportBatch }));
import { handleImport } from "./import";
afterAll(() => testDb.close());

const request = (
  columns: string[],
  rows: Array<Array<string | number | null>>,
) =>
  new Request("https://local.test/operator/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-openseo-operator-secret": "fixture-import-operator-secret-only",
    },
    body: JSON.stringify({
      command: "rows",
      table: "projects",
      columns,
      rows,
    }),
  });
it("forces imported project proof false whether supplied true or omitted", async () => {
  await testDb.execute(
    "insert into organization(id,name,slug,created_at) values('organization','Org','org',0)",
  );
  expect(
    (
      await handleImport(
        request(
          ["id", "organization_id", "name", "legacy_setup_absence_proven"],
          [["imported-true", "organization", "Imported", 1]],
        ),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await handleImport(
        request(
          ["id", "organization_id", "name"],
          [["imported-omitted", "organization", "Omitted"]],
        ),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await testDb.execute("select legacy_setup_absence_proven from projects")
    ).rows.map((row) => row.legacy_setup_absence_proven),
  ).toEqual([0, 0]);
});
