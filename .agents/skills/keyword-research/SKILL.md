---
name: keyword-research
description: "Discover keyword opportunities, evaluate metrics and SERPs, and save/tag promising terms."
---

# SEO Pilot Keyword Research

## Goal

Turn seed topics into a prioritized keyword opportunity set using SEO Pilot MCP data. The output should help the user decide what to target, what to save, and what to research next.

## Required inputs

- `projectId`
- One or more seed topics, products, pages, competitors, or audience problems
- Optional market/location/language

If `projectId` is missing, use `list_projects` first. If the target market/location/language is unclear and would materially affect keyword metrics, ask the user; otherwise use the MCP tool defaults.

## Project context

The project-context tools are free and shared with the app and other agents.

1. Call `get_project_context` first and ground the research in it — the business, the goal, the markets, and the competitors and key pages already saved.
2. This skill needs `business_overview` and `current_goal`. If either is empty, run a minimal inline setup: ask the user, or infer from the site and confirm, just enough to fill them, write them back with `update_project_context`, then continue the research. Never front-load the full interview; suggest `seo-project-setup` at the end for the rest.
3. Before spending credits, check the research log. If the same research ran within the last 30 days, reuse that result and say so instead of re-buying it.
4. On finish, write back what is durable — a sharpened `business_overview` or `current_goal`, competitors that kept appearing in the SERPs via `addCompetitors`, pages the keywords should land on via `addKeyPages` — and append a research log entry: `{ appendResearchLog: { summary: "Keyword research: <seeds/market>. Verdict: <conclusion>" } }`.

## Deliver as a report

Deliver through the `seo-report` skill, saving with `skill: "keyword-research"`. If that skill is not available, say so and stop before writing HTML.

## SEO Pilot MCP tools

Tools marked (key) need the optional DataForSEO key. Everything else is free.

- `get_search_console_keyword_ideas`: free keyword ideas from the project's own Search Console: queries the site already gets impressions for, with impressions, clicks, CTR, average position and the best page. Pass `strikingDistanceOnly: true` for positions 5-20. Impressions are not search volume.
- `research_keywords` (key): primary discovery tool. Use 1-5 seeds per call and prefer 150 results unless the user asks for exhaustive research. For demand in one city, county, or region, call `search_serp_locations` and pass the returned `locationName` on the seed: volume, CPC, and competition become local; keyword ideas, KD, and intent stay national.
- `get_keyword_metrics` (key): hydrate up to 700 known keywords with volume, keyword difficulty (KD), search intent, CPC, and monthly trends in one call. Use it to score candidate or known terms — including the Search Console striking-distance queries from step 1.
- `get_ranked_keywords` (key): pull exact ranking keyword rows when a target domain or page is part of the research brief.
- `get_search_console_performance`: when Search Console is connected, start from the project's real first-party demand — queries already earning impressions and near-ranking ("striking distance") terms. Pass `minPosition: 5, maxPosition: 20, minImpressions: 50` so the server filters the striking-distance rows for you (Google sorts by clicks and can't filter by position itself). Then hydrate those striking-distance queries with `get_keyword_metrics` to attach difficulty and intent.
- `get_serp_results` (key): inspect SERPs for the top candidate terms, especially when intent is ambiguous. Pass the same `locationName` for the SERP in one city, county, or region.
- `search_local_businesses`, `get_local_serp_results`, and `get_google_business_questions` (key): use for local SEO topics when a business/location radius matters.
- `list_saved_keywords`: avoid duplicating already-saved work or use existing tags as context.
- `save_keywords`: save selected keywords only after explicit user confirmation.
- `create_rank_tracker` with `source: "gsc"`, then `add_rank_tracking_keywords`: free daily tracking of chosen queries from Search Console.

## Free mode (no DataForSEO key)

SEO Pilot is free by default; DataForSEO is an optional key. If a (key) tool answers "DataForSEO isn't set up", stay in free mode for the rest of the run: call no other (key) tool, and say in the result which parts need the key.

1. Start from `get_search_console_keyword_ideas` (`dateRange: "last_3_months"`, `limit: 200`), then again with `strikingDistanceOnly: true`. That list is the opportunity set: real queries, real positions, the page Google already shows.
2. Map queries to pages with `get_search_console_performance` (`dimensions: ["query","page"]`) when one query splits impressions across URLs.
3. For seeds the site does not rank for yet, read the site and the user's notes for topics, and offer `research_ai_visibility_prompts` for question ideas. Those are model guesses with no demand data: list them as "unvalidated" and never attach a volume.
4. Prioritize by impressions, position and business fit instead of volume and difficulty. In the tables, write `needs key` for volume, KD and CPC. Never estimate them.
5. Offer to track the picks with `create_rank_tracker` (`source: "gsc"`) and save them with `save_keywords`.

Without Search Console connected, free mode has no demand data at all. Say so, link the project's GSC Insights page, and stop before guessing.

## Workflow

1. Normalize seeds into a small set of distinct research angles. If Search Console is connected for the project, first pull `get_search_console_performance` with `minPosition: 5, maxPosition: 20, minImpressions: 50` (default lookback), and hydrate those queries with `get_keyword_metrics` to attach KD and intent. That ranked, hydrated list is your fastest opportunity set — work it before broad discovery.
2. If the request is local SEO, identify the business, location/coordinates or service area, and local categories. Research local volume for that city or county with `research_keywords` and `locationName`. Use `search_local_businesses` and `get_local_serp_results` for the most important location/keyword set instead of relying only on national keyword/SERP data.
3. Call `research_keywords` for exploratory seeds. Use bulk calls when possible.
4. Use `get_keyword_metrics` to hydrate a fixed keyword list — or the striking-distance queries from step 1 — with volume, KD, and intent before prioritizing.
5. Use `get_ranked_keywords` when the user provides a domain/page and wants opportunities based on current rankings, near-misses, or competitor-owned terms.
6. Remove irrelevant, duplicate, branded-only, and off-intent terms.
7. Prioritize by practical opportunity, not volume alone:
   - Strong match to the user's product/page/topic
   - Clear search intent
   - Reasonable difficulty
   - Useful volume/CPC signal
   - SERP where the user can plausibly compete
   - For local SEO, local-pack/Maps visibility and proximity fit
8. Use `get_serp_results` for high-potential or ambiguous keywords when SERP intent would change the recommendation; keep the default check small.
9. Present a shortlist and a longer opportunity table.
10. Ask before saving keywords. When saving, suggest concise tags such as `topic:<topic>`, `intent:<intent>`, or `page:<slug>`.

## Output format

`h1`: the site or topic.

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **The opportunity** — one or two opening sentences naming the best theme and why the site can win it now.
2. **Target these now** — a table of keyword, intent, volume, KD, CPC, and the page to make. Add a bar chart comparing the volumes of the shortlist. In free mode the columns are keyword, impressions, clicks, average position, best page and the change to make, and the chart compares impressions.
3. **Why these** — one finding per keyword that needs justifying: the SERP or metric evidence, then the page to build.
4. **The longer opportunity list** — a second table, same columns.
5. **Risks and caveats** — notes: SERP intent that would change the recommendation, missing metrics written as `unknown`, close-variant volumes that are one bucket rather than several.
6. **What to do next** — an ordered list, including whether to run keyword clustering, write a content brief, or save the chosen keywords.
7. **How this report was made** — opens with the skill link line from `seo-report`, pointing at `https://seo.viral4all.com/docs/skills/keyword-research` ("SEO Pilot Keyword Research skill"), then which tools returned what.

## Guardrails

- Do not invent metrics. If SEO Pilot does not return a value, write `unknown`, or `needs key` when only the DataForSEO key would supply it.
- Search Console impressions are how often the site was shown, not search volume. Never convert one into the other.
- Do not call `save_keywords` without explicit confirmation.
- Prefer business-fit and intent-fit over chasing the largest volume term.
