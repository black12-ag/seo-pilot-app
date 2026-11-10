import { describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { buildSamMcpTools } from "@/server/features/sam/samChatTools";
import { registerSeoPilotTools } from "@/server/mcp/server";
import { makeToolContext } from "@/server/mcp/tools/tool-test-support";

vi.mock("cloudflare:workers", () => ({
  env: {},
  DurableObject: class {
    kind = "mock";
  },
}));

// The built-in skills are prose that names tools. A renamed or misspelled
// tool fails silently at run time (the agent just can't call it), so check
// every tool-like name in every skill against the real registries.
const skillFiles = import.meta.glob<string>("/.agents/skills/*/SKILL.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const frontmatterSchema = z.looseObject({
  name: z
    .string()
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  description: z.string().min(1).max(1024),
});

// Backticked snake_case names that start like a tool does. Field names such
// as `business_overview` or `own_ai` don't match.
const TOOL_NAME =
  /`((?:get|list|run|create|save|set|research|find|search|explore|estimate|add|remove|pin|update|inspect|submit|show|generate|complete|export|compare|delete|accept|start|check|issue|revoke|capture|archive|request|map|read)_[a-z0-9_]+)`/g;

// Free skills added for no-key installs: each must run in SAM and over MCP.
const FREE_SKILLS = [
  "weekly-brief",
  "gsc-quick-wins",
  "content-brief-from-gaps",
  "competitor-movement",
];

// Named in skill text but deliberately not SAM tools: SAM's skill surface
// note tells it the project and its context are already loaded.
const SAM_SKIPPED = new Set(["get_project_context", "list_projects"]);
// SAM's own site-reading tools, named in skills as the in-app way to read pages.
const SAM_ONLY = new Set(["map_links", "read_pages"]);

function skills() {
  return Object.entries(skillFiles).map(([path, raw]) => {
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
    return {
      directory: path.split("/").at(-2) ?? "",
      frontmatter: match ? parseYaml(match[1]) : null,
      tools: new Set([...raw.matchAll(TOOL_NAME)].map((m) => m[1])),
    };
  });
}

function mcpToolNames() {
  const names = new Set<string>();
  registerSeoPilotTools((tool) => {
    names.add(tool.name);
  });
  return names;
}

function samToolNames() {
  const tools = buildSamMcpTools(makeToolContext().auth, {
    id: "project_1",
    domain: "example.com",
  });
  return new Set(Object.keys(tools));
}

describe("built-in skills", () => {
  it("each has valid Agent Skills frontmatter named after its folder", () => {
    for (const skill of skills()) {
      const parsed = frontmatterSchema.safeParse(skill.frontmatter);
      expect(parsed.success, skill.directory).toBe(true);
      expect(parsed.data?.name).toBe(skill.directory);
    }
  });

  it("names only tools that exist in the MCP server or SAM", () => {
    const known = new Set([...mcpToolNames(), ...samToolNames()]);
    const unknown = skills().flatMap((skill) =>
      [...skill.tools]
        .filter((tool) => !known.has(tool))
        .map((tool) => `${skill.directory}: ${tool}`),
    );
    expect(unknown).toEqual([]);
  });

  it("keeps the free skills runnable from both SAM and MCP clients", () => {
    const mcp = mcpToolNames();
    const sam = samToolNames();
    const found = skills().filter((skill) =>
      FREE_SKILLS.includes(skill.directory),
    );
    expect(new Set(found.map((skill) => skill.directory))).toEqual(
      new Set(FREE_SKILLS),
    );
    const missing = found.flatMap((skill) =>
      [...skill.tools].flatMap((tool) => [
        ...(sam.has(tool) || SAM_SKIPPED.has(tool)
          ? []
          : [`${skill.directory}: ${tool} (SAM)`]),
        ...(mcp.has(tool) || SAM_ONLY.has(tool)
          ? []
          : [`${skill.directory}: ${tool} (MCP)`]),
      ]),
    );
    expect(missing).toEqual([]);
  });
});
