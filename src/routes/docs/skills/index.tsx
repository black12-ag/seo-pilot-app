import { createFileRoute } from "@tanstack/react-router";
import { listBuiltInSkills } from "@/server/features/sam/samSkills";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { SkillIndexPage } from "@/client/features/public-site/skills/SkillDocs";
import { renderSkillDocument } from "@/client/features/public-site/skills/renderSkillDocument";

export const Route = createFileRoute("/docs/skills/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        renderSkillDocument({
          title: "Skills — SEO Pilot",
          description:
            "Free SEO and AI-search workflows for SEO Pilot's assistant and for Claude Code or Codex: audits, Search Console quick wins, weekly briefs and more.",
          canonical: `${getPublicOrigin(request)}/docs/skills`,
          body: <SkillIndexPage skills={listBuiltInSkills()} />,
        }),
    },
  },
});
