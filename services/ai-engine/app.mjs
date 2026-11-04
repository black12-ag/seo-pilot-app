import { createServer } from "node:http";
import { isAuthorized } from "./auth.mjs";
import { createEngineService } from "./engine-service.mjs";
import { JobError } from "./job.mjs";
import { log } from "./log.mjs";

const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_SETTINGS_BYTES = 4 * 1024;
const ERRORS = {
  bad_request: [400, "The request isn't valid."],
  bad_engine: [400, "That engine isn't available."],
  bad_model: [400, "That model isn't available for this engine."],
  unauthorized: [401, "A valid token is required."],
  not_found: [404, "Not found."],
  engine_is_api: [409, "API key mode is selected, so no CLI runs here."],
  engine_blocked: [409, "This engine is off until its lockdown test passes."],
  payload_too_large: [413, "The request is too large."],
  queue_full: [429, "The engine is busy. Try again soon."],
  queue_timeout: [429, "The engine is busy. Try again soon."],
  aborted: [499, "The request was cancelled."],
  output_too_large: [502, "The CLI's reply was too large."],
  malformed_output: [502, "The CLI's reply couldn't be read."],
  engine_failed: [502, "The CLI reported an error."],
  lockdown_violation: [
    502,
    "The CLI used a blocked tool, so it was turned off.",
  ],
  not_installed: [503, "This CLI isn't installed on the server."],
  not_signed_in: [503, "This CLI isn't signed in on the server."],
  timeout: [504, "The CLI didn't answer in time."],
  internal: [500, "The service hit an error."],
};

function reply(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(text);
}

function replyError(response, code) {
  const [status, message] = ERRORS[code] ?? ERRORS.internal;
  reply(response, status, { error: { code, message } });
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        reject(new JobError("payload_too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (typeof parsed !== "object" || parsed === null)
          throw new Error("not an object");
        resolve(parsed);
      } catch {
        reject(new JobError("bad_request"));
      }
    });
    request.on("error", reject);
  });
}

function validGenerateBody(body) {
  if (typeof body.prompt !== "string" || !body.prompt.trim()) return false;
  if (body.schema !== undefined) {
    if (typeof body.schema !== "object" || body.schema === null) return false;
    if (body.schema.type !== "object") return false;
    if (JSON.stringify(body.schema).length > MAX_SCHEMA_BYTES) return false;
  }
  if (
    body.timeoutMs !== undefined &&
    (!Number.isSafeInteger(body.timeoutMs) || body.timeoutMs <= 0)
  )
    return false;
  return true;
}

/** Builds the HTTP service. Every route needs the bearer token. */
export function createApp(config) {
  const service = createEngineService(config);
  const handlers = {
    "GET /v1/status": async (_request, response) =>
      reply(response, 200, await service.status()),
    "GET /v1/models": async (request, response, url) => {
      const models = await service.listModels(url.searchParams.get("engine"));
      if (!models) throw new JobError("bad_engine");
      reply(response, 200, models);
    },
    "POST /v1/engine": async (request, response) => {
      const body = await readBody(request, MAX_SETTINGS_BYTES);
      if (
        typeof body.engine !== "string" ||
        (body.model !== undefined &&
          body.model !== null &&
          typeof body.model !== "string")
      )
        throw new JobError("bad_request");
      reply(response, 200, await service.setEngine(body.engine, body.model));
    },
    "POST /v1/test": async (request, response) => {
      const body = await readBody(request, MAX_SETTINGS_BYTES);
      if (body.engine !== undefined && typeof body.engine !== "string")
        throw new JobError("bad_request");
      reply(response, 200, await service.test(body.engine));
    },
    "POST /v1/generate": async (request, response) => {
      const body = await readBody(request, config.maxInputBytes);
      if (!validGenerateBody(body)) throw new JobError("bad_request");
      const controller = new AbortController();
      const onClose = () => {
        if (!response.writableEnded) controller.abort();
      };
      response.on("close", onClose);
      try {
        reply(
          response,
          200,
          await service.generate(
            {
              prompt: body.prompt,
              schema: body.schema,
              timeoutMs: body.timeoutMs,
            },
            controller.signal,
          ),
        );
      } finally {
        response.off("close", onClose);
      }
    },
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (!isAuthorized(request.headers.authorization, config.token)) {
        request.resume();
        return replyError(response, "unauthorized");
      }
      const handler = handlers[`${request.method} ${url.pathname}`];
      if (!handler) {
        request.resume();
        return replyError(response, "not_found");
      }
      await handler(request, response, url);
    } catch (error) {
      const code = error?.code && ERRORS[error.code] ? error.code : "internal";
      if (code === "internal") log("request.failed", { path: url.pathname });
      if (!response.headersSent) replyError(response, code);
      else response.end();
    }
  });
  return { server, startUp: service.startUp };
}
