# SEO Pilot

[![CI](https://github.com/black12-ag/seo-pilot-app/actions/workflows/ci.yml/badge.svg)](https://github.com/black12-ag/seo-pilot-app/actions/workflows/ci.yml)

A self-hosted SEO and AI search workspace: research, audits, rank tracking, AI visibility, competitors, content review and reports, in one place.

## Run it

You need Node.js 22, `corepack pnpm`, and Docker.

```sh
corepack pnpm install --frozen-lockfile
```

Then follow [the self-hosting guide](docs/SELF_HOSTING_SEO_PILOT.md). Data features need your own DataForSEO key. AI features need one of the two routes below.

## Choose your AI

You choose how AI runs, and you can change it at any time in Settings with no redeploy.

|              | API key                       | Your subscription                                                         |
| ------------ | ----------------------------- | ------------------------------------------------------------------------- |
| Runs through | OpenRouter                    | Your own logged-in `agy`, `claude` or `codex` command-line tool           |
| You pay      | Per use, billed by OpenRouter | Nothing per call. Your provider's plan and limits apply                   |
| Setup        | Set `OPENROUTER_API_KEY`      | Run a small local service, then set `AI_ENGINE_URL` and `AI_ENGINE_TOKEN` |

API key is the default. To switch, open **Settings** and use the **AI engine** section. Setup and security notes are in [docs/AI_ENGINE.md](docs/AI_ENGINE.md).

**Subscription logins are for your own use.** Check your provider's terms, and don't serve paying customers from one. Free-tier providers may use your prompts to improve their products.

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
