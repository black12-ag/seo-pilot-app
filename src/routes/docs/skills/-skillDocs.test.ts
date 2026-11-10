import { describe, expect, it, vi } from "vitest";
import { load } from "cheerio";

vi.mock("cloudflare:workers", () => ({
  env: { AUTH_MODE: "password", BETTER_AUTH_URL: "https://seo.example.com" },
}));

const { Route: IndexRoute } = await import("./index");
const { Route: SkillRoute } = await import("./$skill");

const next = () => {
  throw new Error("Public document must not delegate");
};

async function getIndex(url: string) {
  const handlers = IndexRoute.options.server?.handlers;
  if (typeof handlers !== "object" || typeof handlers.GET !== "function") {
    throw new Error("Skill index must expose GET");
  }
  const response = await handlers.GET({
    request: new Request(url),
    context: undefined,
    params: {},
    pathname: "/docs/skills",
    next,
  });
  if (!(response instanceof Response)) throw new Error("Expected a page");
  return response;
}

async function getSkill(url: string, skill: string) {
  const handlers = SkillRoute.options.server?.handlers;
  if (typeof handlers !== "object" || typeof handlers.GET !== "function") {
    throw new Error("Skill page must expose GET");
  }
  const response = await handlers.GET({
    request: new Request(url),
    context: undefined,
    params: { skill },
    pathname: "/docs/skills/$skill",
    next,
  });
  if (!(response instanceof Response)) throw new Error("Expected a response");
  return response;
}

describe("public skill pages", () => {
  it("lists the built-in skills with links and no scripts", async () => {
    const response = await getIndex("https://seo.example.com/docs/skills");
    const $ = load(await response.text());
    expect($("link[rel=canonical]").attr("href")).toBe(
      "https://seo.example.com/docs/skills",
    );
    expect($("a[href='/docs/skills/seo-audit']").length).toBe(1);
    expect($("a[href='/docs/skills/weekly-brief']").length).toBe(1);
    expect($("script")).toHaveLength(0);
  });

  it("renders one skill, downloads its SKILL.md and 404s unknown names", async () => {
    const page = await getSkill(
      "https://seo.example.com/docs/skills/gsc-quick-wins",
      "gsc-quick-wins",
    );
    expect(page.status).toBe(200);
    const $ = load(await page.text());
    expect($("h1")).toHaveLength(1);
    expect($("h1").text()).toBe("GSC Quick Wins");
    expect($(".skill-body").text().length).toBeGreaterThan(200);

    const md = await getSkill(
      "https://seo.example.com/docs/skills/gsc-quick-wins?format=md",
      "gsc-quick-wins",
    );
    expect(md.headers.get("content-disposition")).toContain("SKILL.md");
    expect(await md.text()).toMatch(/^---\nname: gsc-quick-wins/);

    const missing = await getSkill(
      "https://seo.example.com/docs/skills/nope",
      "nope",
    );
    expect(missing.status).toBe(404);
  });
});
