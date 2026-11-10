// robots.txt, sitemap.xml and llms.txt for the public pages. The app itself
// (projects, settings, API) stays out of search; only the landing page and
// the legal pages are listed.
const PUBLIC_PAGES = ["/welcome", "/privacy", "/terms"] as const;

const PRIVATE_PREFIXES = [
  "/p/",
  "/api/",
  "/projects",
  "/settings",
  "/ai",
  "/r/",
];

export function robotsTxt(origin: string) {
  return [
    "User-agent: *",
    ...PUBLIC_PAGES.map((page) => `Allow: ${page}`),
    "Allow: /llms.txt",
    ...PRIVATE_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function sitemapXml(origin: string) {
  const urls = PUBLIC_PAGES.map(
    (page) =>
      `  <url><loc>${origin}${page}</loc>${page === "/welcome" ? "<priority>1.0</priority>" : ""}</url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export function llmsTxt(origin: string) {
  return `# SEO Pilot

> Free, open-source, self-hosted SEO and AI-search workspace. Site audits, real Google rankings and keyword ideas from Search Console, free backlinks from Common Crawl, and AI visibility through your own AI login. MIT license.

- [Home](${origin}/welcome): what SEO Pilot does and how to install it
- [Source code and guides](https://github.com/black12-ag/seo-pilot-app): install with one command, link Google, Search Console, Analytics and your AI login
- [Privacy](${origin}/privacy)
- [Terms](${origin}/terms)

## Install

curl -fsSL https://raw.githubusercontent.com/black12-ag/seo-pilot-app/main/scripts/install.sh | sh
`;
}
