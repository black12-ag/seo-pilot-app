import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AiEngineSettings } from "@/server/lib/aiEngine/settings";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

const engineSchema = z.enum(["api", "agy", "claude", "codex"]);

export const getAiEngineSettings = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(({ context }) => AiEngineSettings.get(context));

export const setAiEngine = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(
    z.object({
      engine: engineSchema,
      model: z.string().min(1).max(80).nullable(),
    }),
  )
  .handler(({ context, data }) => AiEngineSettings.set(context, data));

export const testAiEngine = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(z.object({ engine: engineSchema }))
  .handler(({ context, data }) => AiEngineSettings.test(context, data.engine));
