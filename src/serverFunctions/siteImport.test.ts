import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

const { request, service } = vi.hoisted(() => ({
  request: {
    context: {
      userId: "user",
      userEmail: "owner@example.com",
      organizationId: "organization",
      role: "owner",
    },
  },
  service: { listImportableSites: vi.fn(), importSites: vi.fn() },
}));
vi.mock("cloudflare:workers", () => ({ env: {}, waitUntil: () => {} }));
vi.mock("@/server/lib/posthog", () => ({ captureServerEvent: vi.fn() }));
vi.mock("@/server/features/google/oauth-config", () => ({
  hasGoogleOAuthConfig: async () => true,
}));
vi.mock("@/server/features/projects/services/SiteImportService", () => ({
  SiteImportService: service,
}));
vi.mock("@/serverFunctions/middleware", () => ({
  requireAuthenticatedContext: [],
}));
// Only TanStack's request plumbing is replaced.
vi.mock("@tanstack/react-start", () => {
  type Handler = (input: {
    data: unknown;
    context: typeof request.context;
  }) => unknown;
  const build = (schema?: z.ZodType) => ({
    validator: (next: z.ZodType) => build(next),
    handler:
      (handler: Handler) =>
      async ({ data }: { data?: unknown } = {}) =>
        handler({
          data: schema ? schema.parse(data) : data,
          context: request.context,
        }),
  });
  return { createServerFn: () => ({ middleware: () => build() }) };
});

import { importSites, listImportableSites } from "./siteImport";

const sites = [{ accountId: "sub-a", siteUrl: "sc-domain:example.com" }];

describe("site import server functions", () => {
  beforeEach(() => {
    request.context.role = "owner";
    service.listImportableSites.mockResolvedValue({
      connected: true,
      accounts: [],
      sites: [],
    });
    service.importSites.mockResolvedValue([]);
  });

  it("refuses a member, who can't create projects or bind Search Console", async () => {
    request.context.role = "member";

    await expect(importSites({ data: { sites } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(service.importSites).not.toHaveBeenCalled();
    expect(await listImportableSites()).toMatchObject({ canImport: false });
  });

  it("imports for the caller's organization only", async () => {
    await importSites({ data: { sites } });

    expect(service.importSites).toHaveBeenCalledWith({
      customer: request.context,
      sites,
    });
    expect(await listImportableSites()).toMatchObject({
      canImport: true,
      googleOAuthConfigured: true,
    });
    expect(service.listImportableSites).toHaveBeenCalledWith({
      organizationId: "organization",
      userId: "user",
    });
  });
});
