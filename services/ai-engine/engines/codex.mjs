import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { jsonLines, safeToolName } from "./shared.mjs";

const DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "shell_snapshot",
  "apps",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "code_mode_host",
  "image_generation",
  "in_app_browser",
  "hooks",
  "memories",
  "multi_agent",
  "plugins",
  "remote_plugin",
  "skill_search",
  "sleep_tool",
  "tool_suggest",
  "view_image",
  "web_search_cached",
  "web_search_request",
  "workspace_dependencies",
  "goals",
];
// These hold names the caller chose, so a property called "format" is kept.
const NAME_MAPS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
]);
const CONVERSATION_ITEMS = new Set(["agent_message", "reasoning", "todo_list"]);
const ASSERTION_KEYWORDS = new Set([
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "default",
]);

/**
 * The output schema format wants every property required and nothing extra,
 * and refuses some checks. The caller validates the full schema on the reply.
 */
function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const strict = {};
  for (const [key, value] of Object.entries(schema)) {
    if (ASSERTION_KEYWORDS.has(key)) continue;
    if (NAME_MAPS.has(key))
      strict[key] = Object.fromEntries(
        Object.entries(value).map(([name, inner]) => [
          name,
          strictSchema(inner),
        ]),
      );
    else
      strict[key] =
        key === "enum" || key === "const" || key === "required"
          ? value
          : strictSchema(value);
  }
  if (strict.type === "object" || strict.properties) {
    const names = Object.keys(strict.properties ?? {});
    strict.additionalProperties = false;
    strict.required = names;
  }
  return strict;
}

export const codex = {
  id: "codex",
  label: "Codex CLI",
  binaryName: "codex",
  knownGoodVersions: ["0.162.1"],
  verified: false,
  lockEvidence:
    "No step in the test worked, but this CLI doesn't report its tools, so the result also relies on it trying.",
  defaultModel: "gpt-6-luna",
  fallbackModels: ["gpt-6-luna", "gpt-6-sol", "gpt-5.6-luna", "gpt-5.6-sol"],
  envNames: ["CODEX_HOME"],
  versionArgs: ["--version"],
  signInArgs: ["login", "status"],
  signedInFromCheck: ({ code }) => code === 0,
  modelsArgs: ["debug", "models"],
  parseModels(stdout) {
    try {
      const parsed = JSON.parse(stdout);
      return (parsed.models ?? [])
        .filter((model) => model.visibility !== "hide")
        .map((model) => model.slug)
        .filter((slug) => typeof slug === "string");
    } catch {
      return [];
    }
  },
  async prepare({ model, schema, privateDir, workDir }) {
    const args = [
      "exec",
      "--json",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--sandbox",
      "read-only",
      "--cd",
      workDir,
      "--model",
      model,
      "--config",
      'approval_policy="never"',
      "--config",
      'web_search="disabled"',
      "--config",
      "mcp_servers={}",
      "--config",
      'shell_environment_policy.inherit="none"',
      "--config",
      "project_doc_max_bytes=0",
      "--config",
      "skills.include_instructions=false",
      "--config",
      "skills.bundled.enabled=false",
      "--config",
      "include_apps_instructions=false",
      "--config",
      "include_environment_context=false",
    ];
    for (const feature of DISABLED_FEATURES) args.push("--disable", feature);
    if (schema) {
      const file = join(privateDir, "output-schema.json");
      await writeFile(file, JSON.stringify(strictSchema(schema)), {
        mode: 0o600,
      });
      args.push("--output-schema", file);
    }
    // A lone "-" reads the prompt from stdin, so it never reaches the arguments.
    args.push("-");
    return args;
  },
  stdin: (prompt) => prompt,
  parse(stdout, { wantsJson }) {
    const tools = new Set();
    let text = null;
    let usage = null;
    let failure = null;
    for (const line of jsonLines(stdout)) {
      if (line.type === "item.completed" || line.type === "item.started") {
        const kind = line.item?.type;
        if (kind === "agent_message" && typeof line.item.text === "string")
          text = line.item.text;
        else if (kind && !CONVERSATION_ITEMS.has(kind) && kind !== "error")
          tools.add(safeToolName(kind));
      }
      if (line.type === "turn.completed") usage = line.usage ?? null;
      if (line.type === "turn.failed" || line.type === "error")
        failure = line.error?.message ?? line.message ?? "";
    }
    if (failure !== null)
      return {
        failure: "engine_failed",
        errorText: failure,
        tools: [...tools],
      };
    if (text === null)
      return { failure: "malformed_output", tools: [...tools] };
    let structured = null;
    if (wantsJson) {
      try {
        structured = JSON.parse(text);
      } catch {
        return { failure: "malformed_output", tools: [...tools] };
      }
    }
    return {
      text: text.trim(),
      structured,
      usage: usage && {
        inputTokens: usage.input_tokens ?? null,
        outputTokens: usage.output_tokens ?? null,
        cachedInputTokens: usage.cached_input_tokens ?? null,
        reasoningTokens: null,
      },
      tools: [...tools],
    };
  },
};
