import { afterEach, describe, expect, it, vi } from "vitest";
import { hasOperatorSecret, isOperatorRequest } from "./operator-auth";

const { env } = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock("cloudflare:workers", () => ({ env }));

const SECRET = "s".repeat(32);

afterEach(() => {
  delete env.SEO_PILOT_OPERATOR_SECRET;
  delete env.OPENSEO_OPERATOR_SECRET;
});

describe("operator secret", () => {
  it("accepts the current setting and header", () => {
    env.SEO_PILOT_OPERATOR_SECRET = SECRET;
    expect(
      isOperatorRequest(new Headers({ "x-seo-pilot-operator-secret": SECRET })),
    ).toBe(true);
  });

  it("keeps working on a server that still has the old setting", () => {
    env.OPENSEO_OPERATOR_SECRET = SECRET;
    expect(hasOperatorSecret()).toBe(true);
    expect(
      isOperatorRequest(new Headers({ "x-seo-pilot-operator-secret": SECRET })),
    ).toBe(true);
  });

  it("accepts the old header", () => {
    env.SEO_PILOT_OPERATOR_SECRET = SECRET;
    expect(
      isOperatorRequest(new Headers({ "x-openseo-operator-secret": SECRET })),
    ).toBe(true);
  });

  it("rejects a wrong secret under either header", () => {
    env.OPENSEO_OPERATOR_SECRET = SECRET;
    expect(
      isOperatorRequest(
        new Headers({ "x-seo-pilot-operator-secret": "wrong" }),
      ),
    ).toBe(false);
    expect(
      isOperatorRequest(new Headers({ "x-openseo-operator-secret": "wrong" })),
    ).toBe(false);
  });

  it("stays off with no secret set", () => {
    expect(hasOperatorSecret()).toBe(false);
    expect(
      isOperatorRequest(new Headers({ "x-seo-pilot-operator-secret": SECRET })),
    ).toBe(false);
  });
});
