import { createFileRoute } from "@tanstack/react-router";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { sitemapXml } from "@/server/lib/publicSeoFiles";
import { listBuiltInSkills } from "@/server/features/sam/samSkills";

const skillPaths = () => [
  "/docs/skills",
  ...listBuiltInSkills().map((skill) => `/docs/skills/${skill.name}`),
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(sitemapXml(getPublicOrigin(request), skillPaths()), {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
