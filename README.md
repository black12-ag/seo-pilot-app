# SEO Pilot

[![CI](https://github.com/black12-ag/seo-pilot-app/actions/workflows/ci.yml/badge.svg)](https://github.com/black12-ag/seo-pilot-app/actions/workflows/ci.yml)

A self-hosted SEO and AI search workspace: research, audits, rank tracking, AI visibility, competitors, content review and reports, in one place.

## Run it

You need Node.js 22, `corepack pnpm`, and Docker.

```sh
corepack pnpm install --frozen-lockfile
```

Then follow [the self-hosting guide](docs/SELF_HOSTING_SEO_PILOT.md). It runs free with no paid keys. See below for what that covers.

## Free setup

You need:

- Your Google account, for Search Console and Analytics.
- The audit, which is SEO Pilot's own crawler and needs no account.
- Your own AI login, such as `agy`, through [the AI engine](docs/AI_ENGINE.md).

You get site audits, Search Console and Analytics reports, website research, Opportunities built from that data, content drafts, reports and the SAM assistant.

Free mode doesn't include competitor discovery, keyword volume and difficulty, backlinks, rank tracking, local rankings or AI answer tracking. Those pages stay in the menu marked **Optional** and never show made-up numbers. Page speed in audits comes from Google PageSpeed Insights and needs your own free `PAGESPEED_API_KEY`. See [the self-hosting guide](docs/SELF_HOSTING_SEO_PILOT.md).

**Optional: add DataForSEO for competitor, backlink and ranking data.** It's pay-as-you-go. See [DataForSEO API key](docs/DATAFORSEO_API_KEY.md).

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
