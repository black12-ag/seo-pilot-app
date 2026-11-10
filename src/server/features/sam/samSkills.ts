import { sort } from "remeda";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { SkillSource } from "agents/skills";

// Bundle the repo's public-facing skills (.agents/skills) into SAM at build
// time. Skills marked `metadata.internal: true` are repo-dev tooling and stay
// out. The glob names the dot-directory literally, so Vite matches it.
//
// The source implements the `SkillSource` interface by hand (type-only import
// above): the `agents/skills` runtime module drags in the skill-*script*
// executor graph (@cloudflare/codemode, just-bash), which a static in-memory
// manifest doesn't need.
const skillFiles = import.meta.glob<string>("/.agents/skills/*/SKILL.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

// The skill bodies are written for external MCP clients (Claude Code); this
// note reframes the surface so SAM skips the steps that don't apply in-app.
export const SAM_SURFACE_NOTE = `> Surface note: you are SAM, running inside the SEO Pilot app. You are already
> authenticated and scoped to the user's current project — skip any "verify the
> MCP connection", "choose a project", or skill-install steps. You have no
> local filesystem: skip local-folder and file steps.
>
> Your project context is already in your system prompt — read it there; there
> is no get_project_context tool here. Write durable facts about the business
> back with update_project_context. You have no report tools: skip any step
> that says to deliver through the seo-report skill or to save a report, and
> give the findings in chat, short and scannable.
> If a skill step needs a tool you don't have (e.g. project creation), say so
> and point the user at the app page rather than improvising.`;

/** A bundled skill as SAM and the Skills page see it. */
type BuiltInSkill = {
  name: string;
  description: string;
  /** The markdown steps, without frontmatter or SAM's surface note. */
  instructions: string;
  /** The whole SKILL.md as shipped, for "Download SKILL.md". */
  raw: string;
};

const frontmatterSchema = z.looseObject({
  name: z.string().min(1),
  description: z.string().min(1),
  metadata: z.looseObject({ internal: z.boolean().optional() }).optional(),
});

function parseSkill(path: string, raw: string): BuiltInSkill | null {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`Skill has no frontmatter: ${path}`);
  const parsed = frontmatterSchema.safeParse(parseYaml(match[1]));
  if (!parsed.success) {
    throw new Error(`Skill frontmatter needs name + description: ${path}`);
  }
  const frontmatter = parsed.data;
  if (frontmatter.metadata?.internal === true) return null;
  // Public for `npx skills add` users but not an in-app workflow: it drafts
  // GitHub issues for contributors, which SAM has no surface for.
  if (frontmatter.name === "simple-issue-description") return null;
  // SAM has no report tools, so the report-writing skill has nothing to drive.
  if (frontmatter.name === "seo-report") return null;
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    instructions: match[2].trim(),
    raw,
  };
}

/** Content hash so Think's registry refreshes the catalog when skills change (djb2 — stability matters here, not collision resistance). */
export function skillFingerprint(
  skills: { name: string; body: string }[],
): string {
  let hash = 5381;
  for (const ch of skills.map((s) => `${s.name}\n${s.body}`).join("\n")) {
    hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16);
}

// The bundled skills are fixed per deploy, so parse them once per isolate.
let cachedSkills: BuiltInSkill[] | undefined;
let cachedSource: SkillSource | undefined;

/** SAM's bundled skills, sorted by name. */
export function listBuiltInSkills(): BuiltInSkill[] {
  return (cachedSkills ??= sort(
    Object.entries(skillFiles)
      .map(([path, raw]) => parseSkill(path, raw))
      .filter((skill): skill is BuiltInSkill => skill !== null),
    (a, b) => a.name.localeCompare(b.name),
  ));
}

export function buildSamSkillSource(): SkillSource {
  if (cachedSource) return cachedSource;
  const skills = listBuiltInSkills().map((skill) => ({
    name: skill.name,
    description: skill.description,
    body: `${SAM_SURFACE_NOTE}\n\n${skill.instructions}`,
  }));

  return (cachedSource = {
    id: "seo-pilot-public-skills",
    fingerprint: skillFingerprint(skills),
    list: () =>
      Promise.resolve(
        skills.map(({ name, description }) => ({ name, description })),
      ),
    load: (name) =>
      Promise.resolve(skills.find((skill) => skill.name === name) ?? null),
  });
}
