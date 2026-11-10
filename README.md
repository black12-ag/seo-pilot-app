# SEO Pilot

[![CI](https://github.com/black12-ag/seo-pilot-app/actions/workflows/ci.yml/badge.svg)](https://github.com/black12-ag/seo-pilot-app/actions/workflows/ci.yml)

A free, self-hosted SEO and AI-search workspace: site audits, real Google rankings and keyword ideas, backlinks, AI visibility, content and reports, in one place.

**Website:** [seo.viral4all.com](https://seo.viral4all.com) · **Install:** one command, below · **License:** MIT

## Quick start

1. Run `curl -fsSL https://raw.githubusercontent.com/black12-ag/seo-pilot-app/main/scripts/install.sh | sh` on any computer with Docker.
2. Open `http://localhost:3001/sign-in` and create your account.
3. Add your site and [link your Google account](#link-your-accounts). Audits, rankings and keyword ideas start on their own.

That's it. Everything below is detail.

## Use it yourself

SEO Pilot is free and open source. You run your own copy, with your own Google account and data. Nothing is shared with us or anyone else.

**You need:** a computer or server with Docker, about 2 GB of free memory (4 GB if you also run AI on your own login), and Git.

1. **Install it with one command.**

   ```sh
   curl -fsSL https://raw.githubusercontent.com/black12-ag/seo-pilot-app/main/scripts/install.sh | sh
   ```

   It downloads SEO Pilot, creates its settings with new random secrets, downloads the ready-made image (amd64 or arm64) and starts it. Add `-s -- --with-ai` after `sh` to also run AI on your own signed-in `agy`, `claude` or `codex`, or `-s -- --url https://seo.example.com` for your own domain. Run it again with `--update` to get new versions. `sh scripts/install.sh --help` lists every option.

2. **Or do it by hand.** Copy `deploy/standalone/.env.example` to `deploy/standalone/.env`, set `STORAGE_SECRET_KEY` to a long random value (`openssl rand -hex 32`) and `SEO_PILOT_IMAGE=ghcr.io/black12-ag/seo-pilot-app:latest`, then run `docker compose --project-name seo-pilot --env-file deploy/standalone/.env -f deploy/standalone/compose.yaml up -d`. To build the image yourself instead, use `SEO_PILOT_IMAGE=seo-pilot-platform:local` and add `-f deploy/standalone/compose.build.yaml` and `--build`.

3. **Create your account.** Open `http://localhost:3001/sign-in`. On a new install it takes you to create the first account, which becomes the administrator. After that, sign-ups are closed and others join by invitation. `http://localhost:3001/welcome` is the public home page.

4. **Connect Google.** Set up your own free Google login for [Search Console](docs/SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md) and [Analytics](docs/SELF_HOSTING_GOOGLE_ANALYTICS.md), then add your sites (see [Link your accounts](#link-your-accounts)).

5. **Optional extras:**
   - [Publish it on your own domain](docs/PUBLISH_ON_YOUR_DOMAIN.md) with HTTPS
   - [Add "Continue with Google"](docs/GOOGLE_SIGN_IN.md) to the sign-in page
   - [Run AI on your own `agy`, `claude` or `codex` login](docs/AI_ENGINE.md), or on an OpenRouter key
   - Page speed in audits with a free `PAGESPEED_API_KEY` (see [the self-hosting guide](docs/SELF_HOSTING_SEO_PILOT.md))
   - [Free backlinks from Common Crawl](docs/FREE_BACKLINKS.md): which sites link to you and your competitors, refreshed monthly
   - [Free rank tracking and keyword ideas](docs/FREE_RANKINGS.md) from your own Search Console

Backups, updates and every setting are in [the self-hosting guide](docs/SELF_HOSTING_SEO_PILOT.md).

## Link your accounts

Each link is optional and takes a few minutes. The guides go step by step.

| What                        | Why                                                                                                                         | Where in SEO Pilot                                                                                                                                             | Guide                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Search Console              | Clicks, positions, keyword ideas, free rank tracking                                                                        | A project → **GSC Insights** → **Add Google account** → **Choose property**. Or **Projects** → **New project** → **Import my sites** to add every site at once | [Search Console](docs/SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md) |
| Google Analytics            | Traffic reports per project                                                                                                 | **Project settings** → **Analytics** → connect, then choose the GA4 property                                                                                   | [Analytics](docs/SELF_HOSTING_GOOGLE_ANALYTICS.md)           |
| Continue with Google        | Sign in with Google instead of a password. An account with the same verified email links itself on the first Google sign-in | Sign-in page                                                                                                                                                   | [Google sign-in](docs/GOOGLE_SIGN_IN.md)                     |
| Your AI login               | SAM, drafts, website research and AI visibility, on `agy`, `claude` or `codex` (or an OpenRouter key)                       | **Settings** → **AI engine**                                                                                                                                   | [AI engine](docs/AI_ENGINE.md)                               |
| Page speed                  | Speed scores in audits                                                                                                      | `PAGESPEED_API_KEY` in `deploy/standalone/.env`                                                                                                                | [Self-hosting guide](docs/SELF_HOSTING_SEO_PILOT.md)         |
| Your domain                 | HTTPS address for sign-in and Google callbacks                                                                              | `install.sh --url https://seo.example.com`                                                                                                                     | [Your domain](docs/PUBLISH_ON_YOUR_DOMAIN.md)                |
| Backlinks                   | Who links to you, from Common Crawl                                                                                         | One monthly command                                                                                                                                            | [Free backlinks](docs/FREE_BACKLINKS.md)                     |
| DataForSEO (paid, optional) | Search volume, competitor data, local rankings                                                                              | `DATAFORSEO_API_KEY`                                                                                                                                           | [DataForSEO](docs/DATAFORSEO_API_KEY.md)                     |

The Google logins are your own: you create one free Google Cloud login for your copy of SEO Pilot, and your data goes from Google to your server only.

**Update:** run the install command again with `--update` (from your checkout: `sh scripts/install.sh --update`). **Back up:** see [the self-hosting guide](docs/SELF_HOSTING_SEO_PILOT.md).

## Free setup

You need:

- Your Google account, for Search Console and Analytics.
- The audit, which is SEO Pilot's own crawler and needs no account.
- Your own AI login, such as `agy`, through [the AI engine](docs/AI_ENGINE.md).

You get site audits, Search Console and Analytics reports, website research, Opportunities built from that data, content drafts, reports and the SAM assistant. [Rank Tracking and Keyword Research](docs/FREE_RANKINGS.md) also work, from your own Search Console: daily average positions for your keywords, and the queries your site already shows up for. With [one monthly command](docs/FREE_BACKLINKS.md), Backlinks also shows which sites link to your site and your competitors, from Common Crawl's free public data.

AI Visibility works too: Prompt Tracking, Prompt Explorer, Prompt Research and Citations ask your own AI engine. It answers from what the model knows, without a live web search, so its cited sources are links the model wrote and can be empty. Each answer says which engine and model gave it. See [AI visibility](docs/AI_ENGINE.md#ai-visibility).

Free mode doesn't include competitor discovery, keyword volume and difficulty, link-level backlinks, live rank checks for other sites, local rankings, or AI answers as people see them in ChatGPT, Gemini and other apps. Those pages stay in the menu marked **Optional** and never show made-up numbers. Page speed in audits comes from Google PageSpeed Insights and needs your own free `PAGESPEED_API_KEY`. See [the self-hosting guide](docs/SELF_HOSTING_SEO_PILOT.md).

**Optional: add DataForSEO for competitor, backlink and ranking data.** It's pay-as-you-go. See [DataForSEO API key](docs/DATAFORSEO_API_KEY.md).

## Skills

Skills are step-by-step workflows SAM follows: built-in ones for audits, keyword research, competitors and more, plus your own. Open a project, then **AI Tools** → **Skills**:

- **Write your own** with a name, a line saying when to use it, and the steps. Or duplicate a built-in skill and change it. Your skills are shared across your workspace and never with other workspaces.
- **Save one from a chat:** tell SAM "save this as a skill". It writes a draft you review and turn on.
- **Take it anywhere:** download any skill as `SKILL.md` for Claude Code, Codex or `npx skills add`. Agents on SEO Pilot's MCP server get them with `list_skills` and `get_skill`.
- **Run it on a schedule:** daily or weekly, at your hour, for one project. Each run saves a report. It needs AI set up, and is off until you switch it on.

See [docs/SKILLS.md](docs/SKILLS.md).

### Built-in skills

SAM, the in-app assistant, and any agent connected over MCP (Claude Code, Codex and others) can run these workflows. They live in [`.agents/skills`](.agents/skills). All of them work without a DataForSEO key: they use Search Console, the site audit, free backlinks and your own AI engine, and say plainly which part needs the key instead of guessing numbers.

- **Free from the start:** `weekly-brief`, `gsc-quick-wins`, `content-brief-from-gaps`, `seo-audit`, `seo-coach`, `seo-project-setup`.
- **Free, richer with a key:** `keyword-research`, `keyword-clustering`, `ai-visibility-audit`, `ai-prompt-research`, `competitor-movement`, `competitor-analysis`, `competitive-landscape`, `link-prospecting`.
- **Needs a key for Maps data:** `local-seo`. Without one it checks your local pages instead.

Pages such as audit issues, keyword ideas, AI visibility prompts and Opportunities have an **Ask SAM** button. It opens a new chat with the question filled in; nothing is sent until you press send.

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

## Contributing

Bug reports, ideas and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). Report security problems privately: see [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
