# Contributing

Thanks for helping make SEO Pilot better. Small, focused changes are easiest to review.

## Before you start

- For a bug, open an issue with the steps to reproduce it.
- For a new feature, open an issue first so we can agree on the approach.
- For a security problem, don't open an issue: follow [SECURITY.md](SECURITY.md).

## Set up

```sh
git clone https://github.com/black12-ag/seo-pilot-app.git
cd seo-pilot-app
pnpm install
pnpm dev
```

See [local development](docs/LOCAL_DEVELOPMENT.md) for the database and settings.

## Make the change

- Keep each pull request to one change.
- Add or update tests next to the code you change.
- Database changes need a migration for both SQLite and Postgres (`pnpm db:generate`).
- Never show made-up numbers: if a value has no real source, say so in the UI.
- Write user-facing text in plain, short English.

## Check it

```sh
pnpm types:check
pnpm lint
pnpm test
```

All three must pass before review. CI runs the same checks.

## License

By contributing, you agree your work is released under the [MIT license](LICENSE).
