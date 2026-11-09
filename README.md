# SEO Pilot

[![CI](https://github.com/black12-ag/seo-pilot-app/actions/workflows/ci.yml/badge.svg)](https://github.com/black12-ag/seo-pilot-app/actions/workflows/ci.yml)

A self-hosted SEO and AI search workspace: research, audits, rank tracking, AI visibility, competitors, content review and reports, in one place.

## Use it yourself

SEO Pilot is free and open source. You run your own copy, with your own Google account and data. Nothing is shared with us or anyone else.

**You need:** a computer or server with Docker, about 2 GB of free memory (4 GB if you also run AI on your own login), and Git.

1. **Install it with one command.**

   ```sh
   curl -fsSL https://raw.githubusercontent.com/black12-ag/seo-pilot-app/main/scripts/install.sh | sh
   ```

   It downloads SEO Pilot, creates its settings with new random secrets, downloads the ready-made image (amd64 or arm64) and starts it. Add `-s -- --with-ai` after `sh` to also run AI on your own signed-in `agy`, `claude` or `codex`, or `-s -- --url https://seo.example.com` for your own domain. Run it again with `--update` to get new versions. `sh scripts/install.sh --help` lists every option.

2. **Or do it by hand.** Copy `deploy/standalone/.env.example` to `deploy/standalone/.env`, set `STORAGE_SECRET_KEY` to a long random value (`openssl rand -hex 32`) and `SEO_PILOT_IMAGE=ghcr.io/black12-ag/seo-pilot-app:latest`, then run `docker compose --project-name seo-pilot --env-file deploy/standalone/.env -f deploy/standalone/compose.yaml up -d`. To build the image yourself instead, use `SEO_PILOT_IMAGE=seo-pilot-platform:local` and add `-f deploy/standalone/compose.build.yaml` and `--build`.

3. **Create your account.** Open `http://localhost:3001/welcome`. The first person to sign up becomes the administrator. After that, sign-ups are closed and others join by invitation.

4. **Connect Google.** Set up your own free Google login for [Search Console](docs/SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md) and [Analytics](docs/SELF_HOSTING_GOOGLE_ANALYTICS.md), then add a project for your site and connect it.

5. **Optional extras:**
   - [Publish it on your own domain](docs/PUBLISH_ON_YOUR_DOMAIN.md) with HTTPS
   - [Add "Continue with Google"](docs/GOOGLE_SIGN_IN.md) to the sign-in page
   - [Run AI on your own `agy`, `claude` or `codex` login](docs/AI_ENGINE.md), or on an OpenRouter key
   - Page speed in audits with a free `PAGESPEED_API_KEY` (see [the self-hosting guide](docs/SELF_HOSTING_SEO_PILOT.md))
   - [Free backlinks from Common Crawl](docs/FREE_BACKLINKS.md): which sites link to you and your competitors, refreshed monthly
   - [Free rank tracking and keyword ideas](docs/FREE_RANKINGS.md) from your own Search Console

Backups, updates and every setting are in [the self-hosting guide](docs/SELF_HOSTING_SEO_PILOT.md).

## Free setup

You need:

- Your Google account, for Search Console and Analytics.
- The audit, which is SEO Pilot's own crawler and needs no account.
- Your own AI login, such as `agy`, through [the AI engine](docs/AI_ENGINE.md).

You get site audits, Search Console and Analytics reports, website research, Opportunities built from that data, content drafts, reports and the SAM assistant. [Rank Tracking and Keyword Research](docs/FREE_RANKINGS.md) also work, from your own Search Console: daily average positions for your keywords, and the queries your site already shows up for. With [one monthly command](docs/FREE_BACKLINKS.md), Backlinks also shows which sites link to your site and your competitors, from Common Crawl's free public data.

AI Visibility works too: Prompt Tracking, Prompt Explorer, Prompt Research and Citations ask your own AI engine. It answers from what the model knows, without a live web search, so its cited sources are links the model wrote and can be empty. Each answer says which engine and model gave it. See [AI visibility](docs/AI_ENGINE.md#ai-visibility).

Free mode doesn't include competitor discovery, keyword volume and difficulty, link-level backlinks, live rank checks for other sites, local rankings, or AI answers as people see them in ChatGPT, Gemini and other apps. Those pages stay in the menu marked **Optional** and never show made-up numbers. Page speed in audits comes from Google PageSpeed Insights and needs your own free `PAGESPEED_API_KEY`. See [the self-hosting guide](docs/SELF_HOSTING_SEO_PILOT.md).

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
