import { describe, expect, it } from "vitest";
import { Route as PrivacyRoute } from "./privacy";
import { Route as TermsRoute } from "./terms";

type Handlers = { server: { handlers: { GET: () => Response } } };

async function read(route: unknown) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the static handler is read
  return (route as { options: Handlers }).options.server.handlers.GET().text();
}

describe("legal pages", () => {
  it("names what the policy must disclose", async () => {
    const privacy = await read(PrivacyRoute);
    for (const text of ["DataForSEO", "OpenRouter", "PostHog", "13 months"]) {
      expect(privacy).toContain(text);
    }
    expect(privacy).toContain("support@viral4all.com");
  });

  it("states the age limit and links the policy", async () => {
    const terms = await read(TermsRoute);
    expect(terms).toContain("at least 18");
    expect(terms).toContain('href="/privacy"');
  });
});
