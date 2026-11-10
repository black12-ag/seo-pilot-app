import { describe, expect, it } from "vitest";
import { load } from "cheerio";
import { Route } from "./welcome";
import {
  INSTALL_COMMAND,
  REPO_URL,
} from "@/client/features/public-site/landing/LandingPage";

describe("public welcome document", () => {
  it("serves semantic content and honest metadata without a session or JavaScript", async () => {
    const handlers = Route.options.server?.handlers;
    if (typeof handlers !== "object" || typeof handlers.GET !== "function") {
      throw new Error("Welcome must expose a GET server handler");
    }
    const response = await handlers.GET({
      request: new Request("http://localhost/welcome"),
      context: undefined,
      params: {},
      pathname: "/welcome",
      next: () => {
        throw new Error("Public document must not delegate");
      },
    });
    if (!(response instanceof Response))
      throw new Error("Expected a document response");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    const html = await response.text();
    expect(html).toMatch(/^<!doctype html>/);
    const $ = load(html);
    expect($("html").attr("lang")).toBe("en");
    expect($("title").text()).toContain("SEO Pilot");
    expect($("meta[name=description]").attr("content")).toContain(
      "Search Console",
    );
    expect($("meta[name=viewport]").attr("content")).toContain(
      "width=device-width",
    );
    expect($("h1")).toHaveLength(1);
    expect($("h1").attr("aria-label")).toBe("SEO Pilot");
    expect($("main").text()).toContain("Never a made-up number");
    expect($("main").text()).toContain(INSTALL_COMMAND);
    expect($("main").text()).toContain("example data, not a real site");
    expect($("iframe, form")).toHaveLength(0);
    // Only the page's own script files, never inline code or other hosts.
    $("script").each((_, script) => {
      expect($(script).attr("src")).toMatch(/^\/landing(-init)?\.js$/);
      expect($(script).text()).toBe("");
    });
    expect(response.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
  });

  it("uses working public destinations and local anchors without prototype records", async () => {
    const handlers = Route.options.server?.handlers;
    if (typeof handlers !== "object" || typeof handlers.GET !== "function") {
      throw new Error("Welcome must expose a GET server handler");
    }
    const response = await handlers.GET({
      request: new Request("http://localhost/welcome"),
      context: undefined,
      params: {},
      pathname: "/welcome",
      next: () => {
        throw new Error("Public document must not delegate");
      },
    });
    if (!(response instanceof Response))
      throw new Error("Expected a document response");
    const html = await response.text();
    const $ = load(html);
    // "/" sends signed-out visitors back here, so sign-in must go to /sign-in.
    expect(
      $("a").filter((_, link) => $(link).attr("href") === "/").length,
    ).toBe(0);
    expect($("a[href='/sign-in']").length).toBeGreaterThan(0);
    expect($(`a[href='${REPO_URL}']`).length).toBeGreaterThan(0);
    $("a").each((_, link) => {
      const href = $(link).attr("href");
      if (href?.startsWith(REPO_URL)) return;
      expect(href).toMatch(/^(\/(?:welcome|privacy|terms|sign-in)$|#)/);
      if (href?.startsWith("#")) expect($(href)).toHaveLength(1);
    });
    expect(html).not.toMatch(
      /figma\.com|mobbin\.com|ethio-viral\.com|2,841|12\.4%/,
    );
  });
});
