import { createServerFn } from "@tanstack/react-start";
import { ownAiEngineView } from "@/server/features/ai-visibility/providers/aiEngineEvidence";
import { hasDataforseoAccess } from "@/server/lib/provider-access";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

export const getSeoApiKeyStatus = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async () => {
    const configured = await hasDataforseoAccess();
    // Page speed runs on DataForSEO when it has a key, otherwise on Google's
    // API, which refused calls without a key when last tried.
    const pageSpeedNeedsKey =
      !configured && !(await getOptionalEnvValue("PAGESPEED_API_KEY"));
    // AI visibility pages also work on the installation's own AI engine.
    const ownAiEngine = await ownAiEngineView();
    return { configured, pageSpeedNeedsKey, ownAiEngine };
  });
