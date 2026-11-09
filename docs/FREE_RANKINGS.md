# Free rankings and keyword ideas from Search Console

With no DataForSEO key, Rank Tracking and Keyword Research use your own
Google Search Console data. It's free, comes straight from Google, and covers
only sites you have verified in Search Console. SEO Pilot never scrapes Google.

First [connect Search Console](SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md) to the
project.

## Rank Tracking

Add a domain and pick **Search Console** as the data source (it's the only
choice when there's no key). Then add keywords, or pick them from the queries
your site already gets.

- The last 30 days fill in right away. After that, one new day is added each
  day by the built-in scheduler. You don't need to do anything.
- You can limit it to one country (a 3-letter code such as `usa`) and to
  desktop, mobile or both. Tablet searches are left out.
- **Refresh from Search Console** fetches any days still missing. It's free.

What the numbers mean:

- **Position** is Google's average position over that day's impressions, to
  one decimal. It's not a single live check.
- A keyword only has a position on days your site was shown for it. Other days
  show "no impr." (no impressions).
- Search Console data is about 2-3 days behind. Only final days are stored.
- Each data point is marked with its source. Search Console trackers and
  DataForSEO trackers are separate and never mix.

Google limits how often Search Console can be read. A daily refresh is two or
three small requests per tracker, well inside those limits.

## Keyword Research

Lists the queries your site already gets impressions for, with impressions,
clicks, CTR, average position and the best-ranking page. The **Striking
distance** tab shows queries at positions 5 to 20, where a better page most
often reaches page one.

Impressions are how often your site was shown, not search volume. Only queries
your site appeared for are listed. Select queries to save them to Saved
Keywords; they also appear in Keyword Clusters.

## What still needs a key

Keyword Gap, Domain Overview for other sites and Local SEO need data about
other sites, which has no free and legitimate source. With no key, those pages
point you to the free pages above, GSC Insights (your own site's totals, top
queries and top pages) and [free backlinks](FREE_BACKLINKS.md).

## For agents (MCP)

- `create_rank_tracker` with `source: "gsc"` creates a free tracker.
  `run_rank_tracker` refreshes it without `maxCostCredits`.
- `get_search_console_keyword_ideas` returns the keyword ideas above.
