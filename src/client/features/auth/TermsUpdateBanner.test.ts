import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const { session } = vi.hoisted(() => ({
  session: {
    value: null as { user: { termsAcceptedVersion: string | null } } | null,
  },
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: session.value, refetch: vi.fn() }),
}));
vi.mock("@/serverFunctions/terms", () => ({ acceptTermsUpdate: vi.fn() }));

import { CURRENT_TERMS_VERSION } from "@/shared/terms";
import { TermsUpdateBanner } from "./TermsUpdateBanner";

const render = () =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(TermsUpdateBanner),
    ),
  );

beforeEach(() => {
  session.value = null;
});

it.each(["2026-11", null])(
  "asks a user who accepted version %s to accept the updated Terms",
  (termsAcceptedVersion) => {
    session.value = { user: { termsAcceptedVersion } };
    const html = render();
    expect(html).toContain("effective November 6, 2026");
    expect(html).toContain("Accept");
  },
);

it("stays hidden once the current version is accepted, or with no session", () => {
  expect(render()).toBe("");
  session.value = { user: { termsAcceptedVersion: CURRENT_TERMS_VERSION } };
  expect(render()).toBe("");
});
