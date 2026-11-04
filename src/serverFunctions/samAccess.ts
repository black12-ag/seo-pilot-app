import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { resolveAiRoute } from "@/server/lib/openrouter";
import {
  getWorkersEnv,
  isHostedServerAuthMode,
} from "@/server/lib/runtime-env";
import { requireProjectContext } from "@/serverFunctions/middleware";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });

type SamAccessStatus = {
  enabled: boolean;
  errorMessage: string | null;
};

// Gates the in-app AI agent (SAM) on a working AI route, a key or the owner's
// own login, the same way backlinks/AI-search gate on their DataForSEO
// subscriptions. Hosted deployments always have the key provisioned, so only
// self-hosted is checked.
export const getSamAccessSetupStatus = createServerFn({ method: "GET" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async (): Promise<SamAccessStatus> => {
    if (await isHostedServerAuthMode()) {
      return { enabled: true, errorMessage: null };
    }

    // Behind an Every App gateway this is the gateway's binding; the gateway
    // answers 503 until an admin sets its OPENROUTER_API_KEY.
    const route = await resolveAiRoute((await getWorkersEnv()) ?? {});
    return { enabled: Boolean(route.access), errorMessage: route.message };
  });
