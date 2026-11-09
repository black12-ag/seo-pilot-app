import { z } from "zod";
import { FreeBacklinksRepository } from "@/server/features/backlinks/repositories/FreeBacklinksRepository";
import { FreeBacklinksService } from "@/server/features/backlinks/services/FreeBacklinksService";
import { freeBacklinksImportSchema } from "@/types/schemas/freeBacklinks";
import { isOperatorRequest } from "./operator-auth";

const commandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("targets") }),
  freeBacklinksImportSchema.extend({ command: z.literal("import") }),
]);

/**
 * Operator endpoint for scripts/celld/runtime/free-backlinks.mjs: lists the
 * domains to prepare, and stores one prepared domain per call. Answers 404
 * without the operator secret, like the account commands.
 */
export async function handleFreeBacklinksOperatorRequest(
  request: Request,
): Promise<Response> {
  if (request.method !== "POST" || !isOperatorRequest(request.headers)) {
    return new Response("Not found", { status: 404 });
  }
  const parsed = commandSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Invalid free backlinks command" },
      { status: 400 },
    );
  const command = parsed.data;
  if (command.command === "targets") {
    return Response.json({
      domains: await FreeBacklinksService.trackedDomains(),
    });
  }
  await FreeBacklinksRepository.saveProfile({
    domain: command.profile.domain,
    release: command.release,
    publishedAt: command.publishedAt,
    referringDomains: command.profile.referringDomains,
    referrers: JSON.stringify(command.profile.referrers),
    importedAt: new Date().toISOString(),
  });
  return Response.json({ ok: true });
}
