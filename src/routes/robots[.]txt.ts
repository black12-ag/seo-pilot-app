import { createFileRoute } from "@tanstack/react-router";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { robotsTxt } from "@/server/lib/publicSeoFiles";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(robotsTxt(getPublicOrigin(request)), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
