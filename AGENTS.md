# Agent guide

## Code

- Prefer simple, flat code. Search for existing helpers before adding new ones.
- New backend work goes: TanStack server function → service → repository.
- Keep every schema change and query working on both SQLite and Postgres.
- Validate untrusted data with Zod at trust boundaries.
- shadcn components in `src/client/components/ui/` use Base UI: compose with `render`, not `asChild`.
- Keep each source file under 500 lines.

## Tests

- Test real behavior at the public entry point. One test per invariant.
- Statically import the module under test. `beforeEach` sets default mock values only.
- Don't mock ORM chains: test repositories through real SQL.
- Don't export a function just for a test. Knip fails on orphaned exports.

## Don't rename these

`openseo-standalone`, the `CELLD_BUCKET` value, the Every App `id`, and the worker names in `wrangler*.json*` (including `open-seo` and `open-seo-audit`) key live data. Renaming them can orphan an existing install. `scripts/old-name.test.ts` lists each remaining use of the old name and why it has to stay.

## Docs

`docs/` is public. Never put private research, logs, credentials or agent notes in this repo.
