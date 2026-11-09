import { createServerFn } from "@tanstack/react-start";
import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { hasGoogleOAuthConfig } from "@/server/features/google/oauth-config";
import { SiteImportService } from "@/server/features/projects/services/SiteImportService";
import { captureServerEvent } from "@/server/lib/posthog";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

// Bounds one request: each site is a project, a binding and an audit start.
const MAX_SITES_PER_IMPORT = 50;

const importSitesSchema = z.object({
  sites: z
    .array(
      z.object({
        accountId: z.string().min(1).max(255),
        siteUrl: z.string().min(1).max(2048),
      }),
    )
    .min(1)
    .max(MAX_SITES_PER_IMPORT),
});

export const listImportableSites = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    const [result, googleOAuthConfigured] = await Promise.all([
      SiteImportService.listImportableSites({
        organizationId: context.organizationId,
        userId: context.userId,
      }),
      hasGoogleOAuthConfig(),
    ]);
    return {
      ...result,
      googleOAuthConfigured,
      // Importing creates projects and binds Search Console to them.
      canImport: hasOrgPermission(context.role, {
        project: ["create"],
        integration: ["manage"],
      }),
    };
  });

export const importSites = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(importSitesSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, {
      project: ["create"],
      integration: ["manage"],
    });
    const results = await SiteImportService.importSites({
      customer: context,
      sites: data.sites,
    });
    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "projects:import_sites",
        organizationId: context.organizationId,
        properties: {
          requested: data.sites.length,
          created: results.filter((r) => r.status === "created").length,
        },
      }),
    );
    return { results };
  });
