import { createFileRoute } from "@tanstack/react-router";
import { listBuiltInSkills } from "@/server/features/sam/samSkills";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import {
  SkillPage,
  skillTitle,
} from "@/client/features/public-site/skills/SkillDocs";
import { renderSkillDocument } from "@/client/features/public-site/skills/renderSkillDocument";

export const Route = createFileRoute("/docs/skills/$skill")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const skill = listBuiltInSkills().find((s) => s.name === params.skill);
        if (!skill) return new Response("Skill not found", { status: 404 });
        // ?format=md downloads the SKILL.md for Claude Code, Codex or `npx skills add`.
        if (new URL(request.url).searchParams.get("format") === "md") {
          return new Response(skill.raw, {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Content-Disposition": `attachment; filename="SKILL.md"`,
            },
          });
        }
        return renderSkillDocument({
          title: `${skillTitle(skill.name)} skill — SEO Pilot`,
          description: skill.description,
          canonical: `${getPublicOrigin(request)}/docs/skills/${skill.name}`,
          body: <SkillPage skill={skill} />,
        });
      },
    },
  },
});
