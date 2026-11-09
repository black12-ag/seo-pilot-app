# Free backlinks from Common Crawl

With no DataForSEO key, the Backlinks page shows which sites link to your project's site and its competitors. The data comes from [Common Crawl's web graph](https://commoncrawl.org/web-graphs), a free public dataset. It needs no account and no key.

## What you get, and its limits

- **Domain-level.** It lists the sites (registrable domains such as `example.com`) that link to a domain from at least one page. It has no single links, pages, anchor text or nofollow flags.
- **Sampled.** Common Crawl crawls part of the web, so counts are lower than paid tools find. A small or new site may not appear at all.
- **A few months old.** Each release covers three months of crawls. Common Crawl publishes a new one about once a month.
- **Your domains only.** It covers each project's site and the competitors on its Context page. A project only sees its own domains.

The page names the release, the months it covers, and when it was published and prepared here. Each domain shows its full referring-domain count and lists up to 2,000 of them, those with the most crawled hosts first. With a DataForSEO key, the page shows DataForSEO data as before.

## Prepare the data

Run one command on the server. It asks the app which domains to prepare, streams the latest release, keeps only the links to those domains, and saves the result in the app.

**Docker self-hosting**, from the repository folder:

```sh
docker compose --project-name seo-pilot --env-file deploy/standalone/.env -f deploy/standalone/compose.yaml run --rm --no-deps init nice -n 19 node --max-old-space-size=512 /opt/standalone/free-backlinks.mjs
```

It runs in its own short-lived container next to the app, at low CPU priority. It downloads about 8.5 GB from Common Crawl: a 1 GB domain list into a temporary file, then a 7 GB link file it reads as it arrives without saving it. It needs about 1 GB of free disk and a few hundred MB of memory, and deletes the temporary file when it ends. Expect 15 to 60 minutes, mostly download time. A dropped connection resumes where it stopped.

**Cloudflare self-hosting:** run it from the repository on any computer with Node.js 22, with `SEO_PILOT_URL` and `SEO_PILOT_OPERATOR_SECRET` in `.env.selfhost`:

```sh
pnpm selfhost:free-backlinks
```

Options:

- `--domain example.com` adds a domain to this run (repeat for more). A project still only sees its own domains.
- `--release cc-main-2026-aug-sep-oct` picks a release instead of the newest one listed on [commoncrawl.org/web-graphs](https://commoncrawl.org/web-graphs).
- `--rows 500` keeps fewer referring domains per domain (default 2,000, at most 5,000).

New projects and competitors are included from the next run.

## Refresh it monthly

Add a cron entry on the host, for example on the 3rd of each month at 04:17:

```cron
17 4 3 * * cd /path/to/seo-pilot-app && docker compose --project-name seo-pilot --env-file deploy/standalone/.env -f deploy/standalone/compose.yaml run --rm --no-deps init nice -n 19 node --max-old-space-size=512 /opt/standalone/free-backlinks.mjs >> free-backlinks.log 2>&1
```

Pick a quiet hour if the server runs other services.

## Terms

Common Crawl's data is free to use under its [Terms of Use](https://commoncrawl.org/terms-of-use). They ask you not to disrupt their servers and to respect the rights of the sites in the crawl, and they make no promise that the data is accurate. This command downloads each file once per run, and the page shows only domain names and counts.
