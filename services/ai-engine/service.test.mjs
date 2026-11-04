import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { startFixture, TOKEN } from "./testkit.mjs";

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

describe("startup", () => {
  it("refuses a missing or short token", () => {
    assert.throws(() => loadConfig({}), /AI_ENGINE_TOKEN/);
    assert.throws(
      () => loadConfig({ AI_ENGINE_TOKEN: "short" }),
      /AI_ENGINE_TOKEN/,
    );
  });

  it("exits with an error when started without a token", async () => {
    const entry = fileURLToPath(new URL("./server.mjs", import.meta.url));
    const child = spawn(process.execPath, [entry], {
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 1);
    assert.match(stderr, /AI_ENGINE_TOKEN/);
  });

  it("listens on loopback by default", () => {
    const config = loadConfig({ AI_ENGINE_TOKEN: TOKEN });
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.loopback, true);
  });
});

describe("auth", () => {
  it("rejects a missing or wrong token on every route", async () => {
    const fx = await fixture();
    for (const [method, path] of [
      ["GET", "/v1/status"],
      ["GET", "/v1/models?engine=agy"],
      ["POST", "/v1/engine"],
      ["POST", "/v1/test"],
      ["POST", "/v1/generate"],
    ]) {
      assert.equal((await fx.call(method, path, undefined, "")).status, 401);
      assert.equal(
        (await fx.call(method, path, undefined, "wrong")).status,
        401,
      );
    }
    assert.deepEqual(await fx.calls(), []);
  });
});

describe("engine choice", () => {
  it("defaults to API key mode and runs nothing", async () => {
    const fx = await fixture();
    const status = await fx.json("GET", "/v1/status");
    assert.equal(status.body.engine, "api");
    assert.equal(status.body.usable, true);
    const generate = await fx.json("POST", "/v1/generate", { prompt: "hi" });
    assert.equal(generate.status, 409);
    assert.equal(generate.body.error.code, "engine_is_api");
    assert.deepEqual(await realJobs(fx), []);
  });

  it("persists a switch to the state file with private permissions", async () => {
    const fx = await fixture();
    await fx.json("POST", "/v1/engine", {
      engine: "agy",
      model: "Gemini 3.8 Flash (Medium)",
    });
    const file = join(fx.dir, "state", "state.json");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
      engine: "agy",
      model: "Gemini 3.8 Flash (Medium)",
    });
    const status = await fx.json("GET", "/v1/status");
    assert.equal(status.body.engine, "agy");
    assert.equal(status.body.model, "Gemini 3.8 Flash (Medium)");
  });

  it("refuses unknown engines and models that could read as flags", async () => {
    const fx = await fixture();
    assert.equal(
      (await fx.json("POST", "/v1/engine", { engine: "bash" })).status,
      400,
    );
    for (const model of [
      "--dangerously-skip-permissions",
      "made up",
      "a".repeat(200),
    ])
      assert.equal(
        (await fx.json("POST", "/v1/engine", { engine: "agy", model })).status,
        400,
      );
  });

  it("lists models from the CLI", async () => {
    const fx = await fixture();
    const models = await fx.json("GET", "/v1/models?engine=agy");
    assert.deepEqual(models.body.models, ["Gemini 3.8 Flash (Low)"]);
    assert.equal(models.body.defaultModel, "Gemini 3.8 Flash (Low)");
    assert.equal((await fx.json("GET", "/v1/models?engine=nope")).status, 400);
  });
});

describe("running a job", () => {
  it("passes fixed args and sends the prompt on stdin, never in the args", async () => {
    const fx = await fixture({ behavior: { job: { text: "hello" } } });
    await selectAgyAndPass(fx);
    const prompt =
      "--dangerously-skip-permissions; $(touch /tmp/x) `id` secret";
    const schema = { type: "object", properties: { a: { type: "string" } } };
    await fx.setBehavior({ job: { structured: { a: "b" } } });
    const result = await fx.json("POST", "/v1/generate", { prompt, schema });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.structured, { a: "b" });
    assert.equal(result.body.engine, "agy");
    assert.equal(result.body.model, "Gemini 3.8 Flash (Low)");
    assert.equal(result.body.billing, "included_in_subscription");
    const job = (await realJobs(fx)).at(-1);
    assert.ok(!job.args.join(" ").includes("secret"));
    assert.equal(JSON.parse(job.stdin.trim()).message.content, prompt);
    assert.deepEqual(job.args.slice(0, 6), [
      "--agent",
      "seo-pilot-text",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
    ]);
    assert.ok(job.args.includes("--disable-slash-commands"));
    const settings = JSON.parse(job.args[job.args.indexOf("--settings") + 1]);
    assert.ok(settings.permissions.deny.includes("command(*)"));
    assert.equal(
      job.args[job.args.indexOf("--json-schema") + 1],
      JSON.stringify(schema),
    );
  });

  it("runs without a shell, in a temp folder, with a minimal environment", async () => {
    const fx = await fixture();
    await selectAgyAndPass(fx);
    await fx.setBehavior({ job: { text: "ok" } });
    await fx.json("POST", "/v1/generate", { prompt: "$HOME" });
    const job = (await realJobs(fx)).at(-1);
    assert.equal(JSON.parse(job.stdin.trim()).message.content, "$HOME");
    assert.match(job.cwd, /seo-pilot-ai-/);
    assert.ok(!existsSync(job.cwd), "the temp folder is removed");
    assert.equal(job.env.OPENAI_API_KEY, undefined);
    assert.equal(job.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(job.env.AI_ENGINE_TOKEN, undefined);
    assert.ok(job.env.PATH);
  });

  it("kills the whole process group on timeout", async () => {
    const fx = await fixture({
      env: { AI_ENGINE_JOB_TIMEOUT_MS: "1500" },
    });
    await selectAgyAndPass(fx);
    const pidFile = join(fx.dir, "child.pid");
    await fx.setBehavior({ job: { hang: true, spawnChild: pidFile } });
    const result = await fx.json("POST", "/v1/generate", { prompt: "hang" });
    assert.equal(result.status, 504);
    assert.equal(result.body.error.code, "timeout");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const pid = Number(readFileSync(pidFile, "utf8"));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  });

  it("stops the CLI when the caller disconnects", async () => {
    const fx = await fixture();
    await selectAgyAndPass(fx);
    const pidFile = join(fx.dir, "child.pid");
    await fx.setBehavior({ job: { hang: true, spawnChild: pidFile } });
    const controller = new AbortController();
    const pending = fetch(`${fx.base}/v1/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ prompt: "hang" }),
      signal: controller.signal,
    }).catch(() => null);
    while (!existsSync(pidFile))
      await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 600));
    const pid = Number(readFileSync(pidFile, "utf8"));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  });

  it("caps output", async () => {
    const fx = await fixture({ env: { AI_ENGINE_MAX_OUTPUT_BYTES: "4096" } });
    await selectAgyAndPass(fx);
    await fx.setBehavior({ job: { flood: 100_000 } });
    const result = await fx.json("POST", "/v1/generate", { prompt: "flood" });
    assert.equal(result.status, 502);
    assert.equal(result.body.error.code, "output_too_large");
  });

  it("limits input size and rejects a bad body", async () => {
    const fx = await fixture({ env: { AI_ENGINE_MAX_INPUT_BYTES: "1024" } });
    await selectAgyAndPass(fx);
    const big = await fx
      .json("POST", "/v1/generate", { prompt: "x".repeat(5000) })
      .catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
    assert.equal(
      (await fx.json("POST", "/v1/generate", { prompt: "" })).status,
      400,
    );
    assert.equal(
      (
        await fx.json("POST", "/v1/generate", {
          prompt: "x",
          schema: { type: "array" },
        })
      ).status,
      400,
    );
  });

  it("rejects malformed CLI output", async () => {
    const fx = await fixture();
    await selectAgyAndPass(fx);
    for (const raw of ["not json at all", '{"event":"result"', ""]) {
      await fx.setBehavior({ job: { raw } });
      const result = await fx.json("POST", "/v1/generate", { prompt: "x" });
      assert.equal(result.status, 502, raw);
      assert.equal(result.body.error.code, "malformed_output");
    }
    await fx.setBehavior({ job: { text: "no json here" } });
    const missing = await fx.json("POST", "/v1/generate", {
      prompt: "x",
      schema: { type: "object" },
    });
    assert.equal(missing.body.error.code, "malformed_output");
  });

  it("reports sign-in trouble without repeating the CLI's text", async () => {
    const fx = await fixture();
    await selectAgyAndPass(fx);
    await fx.setBehavior({
      job: {
        stderr: "Please sign in. prompt was: SECRET",
        exitCode: 1,
        raw: "",
      },
    });
    const result = await fx.json("POST", "/v1/generate", { prompt: "SECRET" });
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, "not_signed_in");
    assert.ok(!JSON.stringify(result.body).includes("SECRET"));
  });
});

describe("queue", () => {
  it("runs one job at a time and refuses past the limit", async () => {
    const fx = await fixture({ env: { AI_ENGINE_QUEUE_LIMIT: "1" } });
    await selectAgyAndPass(fx);
    await fx.setBehavior({ job: { text: "slow", delayMs: 500 } });
    const first = fx.json("POST", "/v1/generate", { prompt: "1" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = fx.json("POST", "/v1/generate", { prompt: "2" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const status = await fx.json("GET", "/v1/status");
    assert.deepEqual(status.body.queue, { running: 1, waiting: 1 });
    const third = await fx.json("POST", "/v1/generate", { prompt: "3" });
    assert.equal(third.status, 429);
    assert.equal(third.body.error.code, "queue_full");
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
  });
});
