import { createFileRoute } from "@tanstack/react-router";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { sitemapXml } from "@/server/lib/publicSeoFiles";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(sitemapXml(getPublicOrigin(request)), {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
