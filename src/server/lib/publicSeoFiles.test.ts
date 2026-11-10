import { describe, expect, it } from "vitest";
import { llmsTxt, robotsTxt, sitemapXml } from "./publicSeoFiles";

const origin = "https://seo.example.com";

describe("public SEO files", () => {
  it("robots.txt allows the public pages, keeps the app out and links the sitemap", () => {
    const robots = robotsTxt(origin);
    expect(robots).toContain("Allow: /welcome");
    expect(robots).toContain("Disallow: /p/");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`);
  });

  it("sitemap.xml lists only the public pages on the configured origin", () => {
    const xml = sitemapXml(origin);
    expect(xml).toContain(`<loc>${origin}/welcome</loc>`);
    expect(xml).toContain(`<loc>${origin}/privacy</loc>`);
    expect(xml).not.toContain("/p/");
    expect(xml.match(/<url>/g)).toHaveLength(3);
    expect(sitemapXml(origin, ["/docs/skills"])).toContain(
      `<loc>${origin}/docs/skills</loc>`,
    );
  });

  it("llms.txt describes the project and links home", () => {
    expect(llmsTxt(origin)).toContain(`${origin}/welcome`);
  });
});
