import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { startFixture } from "./testkit.mjs";

const fixtures = [];
async function fixture(options) {
  const started = await startFixture(options);
  fixtures.push(started);
  return started;
}
after(async () => {
  await Promise.all(fixtures.map((item) => item.close()));
});

const realJobs = async (fx) =>
  (await fx.calls()).filter(
    ({ args }) => args.includes("--agent") && !args.includes("--version"),
  );

async function selectAgyAndPass(fx) {
  const set = await fx.json("POST", "/v1/engine", { engine: "agy" });
  assert.equal(set.status, 200);
  const test = await fx.json("POST", "/v1/test", {});
  assert.equal(test.body.passed, true, test.body.message);
}

describe("lockdown", () => {
  for (const [name, behavior, escaped] of [
    ["a canary read", { readFile: true }, "files"],
    ["a command", { runCommand: true }, "commands"],
    [
      "a public fetch",
      {
        structured: {
          read_value: "",
          command_ran: "",
          local_page: "",
          public_page: `ts=${Math.floor(Date.now() / 1000)}.123`,
        },
      },
      "the web",
    ],
    ["a tool call", { tools: ["search_web"] }, "tools"],
    ["the tool-free agent missing", { agent: null }, "tools"],
    ["the default context loading", { inputTokens: 24_000 }, "tools"],
  ])
    it(`blocks the engine after ${name}`, async () => {
      const fx = await fixture({ behavior: { lockdown: behavior } });
      await fx.json("POST", "/v1/engine", { engine: "agy" });
      const test = await fx.json("POST", "/v1/test", {});
      assert.equal(test.body.passed, false);
      assert.match(test.body.message, new RegExp(escaped));
      const status = await fx.json("GET", "/v1/status");
      assert.equal(status.body.usable, false);
      assert.match(status.body.message, /Blocked/);
      const generate = await fx.json("POST", "/v1/generate", { prompt: "x" });
      assert.equal(generate.status, 409);
      assert.equal(generate.body.error.code, "engine_blocked");
    });

  it("blocks when the test can't finish", async () => {
    const fx = await fixture({
      behavior: { lockdown: { status: "ERROR", error: "x", exitCode: 3 } },
    });
    await fx.json("POST", "/v1/engine", { engine: "agy" });
    const test = await fx.json("POST", "/v1/test", {});
    assert.equal(test.body.passed, false);
    assert.match(test.body.message, /couldn't finish/);
  });

  it("runs the test before the first job, and blocks the job if it fails", async () => {
    const fx = await fixture({ behavior: { lockdown: { runCommand: true } } });
    await fx.json("POST", "/v1/engine", { engine: "agy" });
    const generate = await fx.json("POST", "/v1/generate", {
      prompt: "real work",
    });
    assert.equal(generate.status, 409);
    const jobs = await realJobs(fx);
    assert.ok(jobs.every(({ stdin }) => !stdin.includes("real work")));
  });

  it("requires a new pass when the binary changes", async () => {
    const fx = await fixture({ behavior: { job: { text: "ok" } } });
    await selectAgyAndPass(fx);
    const binary = join(fx.dir, "bin", "agy");
    const { readFile, writeFile } = await import("node:fs/promises");
    await writeFile(binary, `${await readFile(binary, "utf8")}\n// updated\n`);
    const before = (await realJobs(fx)).length;
    await fx.setBehavior({
      lockdown: { runCommand: true },
      job: { text: "ok" },
    });
    const generate = await fx.json("POST", "/v1/generate", {
      prompt: "after update",
    });
    assert.equal(generate.status, 409);
    assert.equal((await realJobs(fx)).length, before + 1);
  });

  it("turns the engine off if a tool appears during real work", async () => {
    const fx = await fixture({ behavior: { job: { text: "ok" } } });
    await selectAgyAndPass(fx);
    await fx.setBehavior({ job: { text: "leak", tools: ["run_command"] } });
    const result = await fx.json("POST", "/v1/generate", { prompt: "x" });
    assert.equal(result.status, 502);
    assert.equal(result.body.error.code, "lockdown_violation");
    assert.ok(!JSON.stringify(result.body).includes("leak"));
    assert.equal((await fx.json("GET", "/v1/status")).body.usable, false);
  });

  it("doesn't mistake a long prompt for the default context in real work", async () => {
    const fx = await fixture({ behavior: { job: { text: "ok" } } });
    await selectAgyAndPass(fx);
    await fx.setBehavior({ job: { text: "ok", inputTokens: 60_000 } });
    const result = await fx.json("POST", "/v1/generate", { prompt: "long" });
    assert.equal(result.status, 200);
  });

  it("turns the engine off if the tool-free agent is missing in real work", async () => {
    const fx = await fixture({ behavior: { job: { text: "ok" } } });
    await selectAgyAndPass(fx);
    await fx.setBehavior({ job: { text: "leak", agent: null } });
    const result = await fx.json("POST", "/v1/generate", { prompt: "x" });
    assert.equal(result.body.error.code, "lockdown_violation");
  });

  it("warns about an unknown version but lets the test decide", async () => {
    const fx = await fixture({ behavior: { version: "9.9.9" } });
    await selectAgyAndPass(fx);
    const status = await fx.json("GET", "/v1/status");
    assert.match(status.body.engines.agy.versionWarning, /9\.9\.9/);
    assert.equal(status.body.engines.agy.knownGood, false);
    assert.equal(status.body.usable, true);
  });

  it("reports whether the CLI is installed and signed in", async () => {
    const fx = await fixture();
    const status = await fx.json("GET", "/v1/status");
    assert.equal(status.body.engines.agy.installed, true);
    assert.equal(status.body.engines.agy.signedIn, true);
    assert.equal(status.body.engines.claude.installed, false);
    assert.equal(status.body.engines.codex.verified, false);
  });
});
