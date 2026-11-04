import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverUrls, parseRobotsTxt } from "@/server/lib/audit/discovery";

// Resolves the request-signing env lookup instantly, so it can't race the
// fake timers below.
vi.mock("cloudflare:workers", () => ({ env: {} }));

function sitemapXml(urls: string[]): string {
  const entries = urls.map((url) => `<url><loc>${url}</loc></url>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset>${entries}</urlset>`;
}

const robotsFile =
  (body = "User-agent: *\nAllow: /") =>
  () =>
    new Response(body);

describe("discoverUrls", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Shopify's edge refuses a crawler's first requests now and then; a sitemap
  // shard dropped on a 429 took every URL in it out of the audit.
  it("retries a sitemap refused with 429 after its Retry-After", async () => {
    vi.useFakeTimers();
    let sitemapFetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/robots.txt")) {
          return Promise.resolve(new Response("User-agent: *\nAllow: /"));
        }
        sitemapFetches += 1;
        return Promise.resolve(
          sitemapFetches === 1
            ? new Response("local_rate_limited", {
                status: 429,
                headers: { "retry-after": "5" },
              })
            : new Response(sitemapXml(["https://example.com/a"]), {
                headers: { "content-type": "application/xml" },
              }),
        );
      }),
    );

    const discovery = discoverUrls("https://example.com", 10);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(sitemapFetches).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const { urls } = await discovery;

    expect(urls).toEqual(["https://example.com/a"]);
  });

  describe("whether the site has a sitemap", () => {
    const XML = { headers: { "content-type": "application/xml" } };
    type Routes = Record<string, () => Response>;
    const serve = (routes: Routes) =>
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) =>
          Promise.resolve(
            routes[new URL(url).pathname]?.() ??
              new Response(null, { status: 404 }),
          ),
        ),
      );

    it("finds a sitemap whose URLs are far past the crawl budget", async () => {
      const products = Array.from(
        { length: 100 },
        (_, index) => `https://example.com/products/${index}`,
      );
      serve({
        "/robots.txt": robotsFile(),
        "/sitemap.xml": () => new Response(sitemapXml(products), XML),
      });
      const { sitemap, urls } = await discoverUrls("https://example.com", 1);
      expect(sitemap).toBe("found");
      expect(urls).toHaveLength(100);
    });

    it.each([
      ["robots.txt answers 404", () => new Response(null, { status: 404 })],
      ["robots.txt names no sitemap", robotsFile()],
    ])("is absent when every place 404s and %s", async (_name, robotsReply) => {
      serve({ "/robots.txt": robotsReply });
      const { sitemap } = await discoverUrls("https://example.com", 10);
      expect(sitemap).toBe("absent");
    });

    it("is absent when the default location serves a web page", async () => {
      serve({
        "/robots.txt": robotsFile(),
        "/sitemap.xml": () =>
          new Response("<!doctype html><title>Home</title>", {
            headers: { "content-type": "text/html" },
          }),
      });
      const { sitemap } = await discoverUrls("https://example.com", 10);
      expect(sitemap).toBe("absent");
    });

    it.each<[string, Routes]>([
      [
        "the sitemap answers 500",
        {
          "/robots.txt": robotsFile(),
          "/sitemap.xml": () => new Response(null, { status: 500 }),
        },
      ],
      [
        "the sitemap answers 403",
        {
          "/robots.txt": robotsFile(),
          "/sitemap.xml": () => new Response(null, { status: 403 }),
        },
      ],
      [
        "the sitemap lists nothing",
        {
          "/robots.txt": robotsFile(),
          "/sitemap.xml": () => new Response(sitemapXml([]), XML),
        },
      ],
      [
        "robots.txt fails, so it may name another sitemap",
        { "/robots.txt": () => new Response(null, { status: 503 }) },
      ],
      [
        "robots.txt names a sitemap on another host",
        {
          "/robots.txt": robotsFile(
            "User-agent: *\nSitemap: https://cdn.example.net/sitemap.xml",
          ),
        },
      ],
      [
        "a sitemap index's children all fail",
        {
          "/robots.txt": robotsFile(),
          "/sitemap.xml": () =>
            new Response(
              '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>',
              XML,
            ),
          "/a.xml": () => new Response(null, { status: 500 }),
        },
      ],
    ])("stays unknown when %s", async (_name, routes) => {
      serve(routes);
      const { sitemap } = await discoverUrls("https://example.com", 10);
      expect(sitemap).toBe("unknown");
    });

    it("stays unknown when the network fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new Error("network down"))),
      );
      const { sitemap } = await discoverUrls("https://example.com", 10);
      expect(sitemap).toBe("unknown");
    });
  });

  // Seeding the frontier is what sets a page's in-sitemap flag, so a URL
  // dropped here reports inSitemap: false once the crawl reaches it through a
  // link. Real sitemaps bury the homepage in the middle of the list
  // (bannerbear.com lists it 387th of 1,328).
  it("returns sitemap URLs listed past the crawl's page budget", async () => {
    const posts = Array.from(
      { length: 5 },
      (_, index) => `https://example.com/blog/post-${index}/`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith("/robots.txt")
            ? new Response("User-agent: *\nAllow: /")
            : new Response(sitemapXml([...posts, "https://example.com/"]), {
                headers: { "content-type": "application/xml" },
              }),
        ),
      ),
    );

    const { urls } = await discoverUrls("https://example.com", 2);

    expect(urls).toContain("https://example.com/");
  });
});

describe("parseRobotsTxt", () => {
  it("applies an SEO-Pilot-Audit group over the wildcard group", () => {
    const robots = parseRobotsTxt(
      "https://example.com",
      "User-agent: *\nAllow: /\n\nUser-agent: SEO-Pilot-Audit\nDisallow: /private/",
    );

    expect(robots.isAllowed("https://example.com/private/page")).toBe(false);
    expect(robots.isAllowed("https://example.com/public")).toBe(true);
  });
});
