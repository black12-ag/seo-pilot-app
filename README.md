# SEO Pilot

A self-hosted SEO and AI search workspace: research, audits, rank tracking, AI visibility, competitors, content review and reports, in one place.

## Run it

You need Node.js 22, `corepack pnpm`, and Docker.

```sh
corepack pnpm install --frozen-lockfile
```

Then follow [the self-hosting guide](docs/SELF_HOSTING_SEO_PILOT.md). Data and model features need your own DataForSEO and OpenRouter keys.

## Develop

```sh
pnpm dev
pnpm test
pnpm types:check
pnpm lint
```

See [local development](docs/LOCAL_DEVELOPMENT.md).

## License

MIT. See [LICENSE](LICENSE).
