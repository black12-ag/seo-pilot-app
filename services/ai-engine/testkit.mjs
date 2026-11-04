import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.mjs";
import { loadConfig } from "./config.mjs";

export const TOKEN = "t".repeat(40);
const UNUSED_BINARY = "/nonexistent/ai-engine-test-binary";

const FAKE_CLI = (behaviorFile, recordFile) => `#!${process.execPath}
const { readFileSync, appendFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
let stdin = "";
try { stdin = readFileSync(0, "utf8"); } catch {}
const behavior = JSON.parse(readFileSync(${JSON.stringify(behaviorFile)}, "utf8"));
appendFileSync(${JSON.stringify(recordFile)}, JSON.stringify({ args, stdin, cwd: process.cwd(), env: process.env }) + "\\n");
if (args[0] === "--version") { console.log(behavior.version ?? "1.5.0"); process.exit(0); }
if (args[0] === "models") { console.log("id-low\\tGemini 3.8 Flash (Low)"); process.exit(0); }
if (args[0] === "auth" || args[0] === "login") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
if (args[0] === "debug") { console.log(JSON.stringify({ models: [{ slug: "gpt-6-luna" }] })); process.exit(0); }
const isLockdown = stdin.includes("Safety check.");
const script = isLockdown ? (behavior.lockdown ?? {}) : (behavior.job ?? {});
if (script.readFile) { const f = /the file (\\S+?)(?:\\\\n|"|\\s)/.exec(stdin)?.[1]; if (f) script.structured = { ...script.structured, read_value: readFileSync(f, "utf8").trim() }; }
if (script.runCommand) { const m = /touch (\\S+?)(?:\\\\n|"|\\s)/.exec(stdin)?.[1]; if (m) writeFileSync(m, "x"); }
if (script.spawnChild) { const { spawn } = require("node:child_process"); const c = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" }); writeFileSync(script.spawnChild, String(c.pid)); }
if (script.hang) { setInterval(() => {}, 1000); return; }
if (script.flood) { process.stdout.write("x".repeat(script.flood)); }
if (script.raw !== undefined) { process.stdout.write(script.raw); }
if (script.stderr) { process.stderr.write(script.stderr); }
if (script.delayMs) { setTimeout(() => finish(), script.delayMs); } else { finish(); }
function finish() {
  if (script.raw === undefined && !script.flood) {
    const structured = script.structured ?? (isLockdown ? { read_value: "", command_ran: "", local_page: "", public_page: "" } : null);
    const out = [];
    out.push(JSON.stringify({ event: "init", init: { agent: script.agent === undefined ? "seo-pilot-text" : script.agent } }));
    for (const tool of script.tools ?? []) out.push(JSON.stringify({ event: "step_update", step_update: { step_type: "tool", tool_name: tool } }));
    out.push(JSON.stringify({ event: "result", result: { status: script.status ?? "SUCCESS", response: script.text ?? "reply text", structured_output: structured ?? undefined, usage: { input_tokens: script.inputTokens ?? 700, output_tokens: 5 }, error: script.error, finished_reason: script.finishedReason } }));
    process.stdout.write(out.join("\\n") + "\\n");
  }
  process.exit(script.exitCode ?? 0);
}
`;

/** A running service whose CLI is a scripted fake. */
export async function startFixture({ behavior = {}, env = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "ai-engine-test-"));
  const binDir = join(dir, "bin");
  await mkdir(binDir);
  const behaviorFile = join(dir, "behavior.json");
  const recordFile = join(dir, "calls.jsonl");
  const binary = join(binDir, "agy");
  await writeFile(behaviorFile, JSON.stringify(behavior));
  await writeFile(recordFile, "");
  await writeFile(binary, FAKE_CLI(behaviorFile, recordFile));
  await chmod(binary, 0o755);
  const config = loadConfig({
    AI_ENGINE_TOKEN: TOKEN,
    AI_ENGINE_PORT: "1",
    AI_ENGINE_STATE_FILE: join(dir, "state", "state.json"),
    AI_ENGINE_AGY_PATH: binary,
    AI_ENGINE_CLAUDE_PATH: UNUSED_BINARY,
    AI_ENGINE_CODEX_PATH: UNUSED_BINARY,
    AI_ENGINE_KILL_GRACE_MS: "200",
    PATH: process.env.PATH,
    HOME: dir,
    OPENAI_API_KEY: "must-not-reach-the-cli",
    ANTHROPIC_API_KEY: "must-not-reach-the-cli",
    ...env,
  });
  const { server } = createApp(config);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body, token = TOKEN) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    dir,
    base,
    call,
    async json(method, path, body) {
      const response = await call(method, path, body);
      return { status: response.status, body: await response.json() };
    },
    setBehavior: (next) => writeFile(behaviorFile, JSON.stringify(next)),
    async calls() {
      const text = await readFile(recordFile, "utf8");
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
