import { createFileRoute } from "@tanstack/react-router";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { llmsTxt } from "@/server/lib/publicSeoFiles";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(llmsTxt(getPublicOrigin(request)), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
