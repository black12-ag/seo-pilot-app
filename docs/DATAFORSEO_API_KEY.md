# DataForSEO API Key Setup

This key is optional. SEO Pilot runs without it: audits, Search Console, Analytics and AI features are all free to use.

[DataForSEO](https://dataforseo.com/?aff=255379) adds competitor discovery, keyword volume and difficulty, backlinks, rank tracking, local rankings and AI answer tracking. It's a pay-as-you-go third-party service unaffiliated with SEO Pilot. With no key, those pages stay in the menu marked **Optional**, show no numbers and charge nothing. Rank Tracking and Keyword Research still work for your own site from Search Console; see [free rankings](FREE_RANKINGS.md).

New DataForSEO accounts include $1 of free credit to test with, and the minimum top-up is $50.

## Get your API key

1. Go to [DataForSEO API Access](https://app.dataforseo.com/api-access?aff=255379) (create an account if you don't have one).
2. Click "Send by email" to get your credentials.
3. Copy the longer credentials labelled "Base64" credentials. This is the base64 encoded value of your DataForSEO email and API password in the format `email:password`.

## Where to set it

Set the value as `DATAFORSEO_API_KEY`:

- **Docker self-hosting:** in `deploy/standalone/.env`.
- **Local development:** in `.env.local` (see [`LOCAL_DEVELOPMENT.md`](./LOCAL_DEVELOPMENT.md)).
