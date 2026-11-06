# Choose how AI runs

SEO Pilot can run AI two ways. You can switch at any time in **Settings > AI engine**, with no code change or redeploy.

- **API key.** OpenRouter, through `OPENROUTER_API_KEY`. This is the default. You pay per use.
- **Your subscription.** Your own logged-in `agy`, `claude` or `codex` command-line tool on your own server. There is no per-call price. Your provider's plan and limits apply.

**Subscription logins are for your own use.** Check your provider's terms, and don't serve paying customers from one. SEO Pilot refuses this mode when `AUTH_MODE=hosted`. Free-tier providers may use your prompts to improve their products.

## How it works

The SEO Pilot runtime can't start programs. A small service in `services/ai-engine/` runs next to it on your server, and only that service runs the command-line tool. It needs Node.js 22 and has no dependencies.

## Set it up

Use a dedicated OS user with nothing else in its home folder. This limits what a tool can write, but it isn't a sandbox. The service removes the tools' abilities and checks that they stayed removed. If a tool ever got past that, nothing at OS level would stop it reading world-readable files, reaching other services on the same machine, or reading this service's token. So don't run this on a machine that holds other sensitive services, such as payments, unless you've added your own isolation, for example a separate VM.

```sh
sudo useradd --create-home seo-pilot-ai
sudo -iu seo-pilot-ai
# Install and sign in to the tool you want, as this user.
agy
```

Create a token and start the service:

```sh
export AI_ENGINE_TOKEN="$(openssl rand -hex 32)"
node services/ai-engine/server.mjs
```

It listens on `127.0.0.1:8719` and refuses to start without a token of at least 32 characters.

Then give SEO Pilot the address and the same token, and restart it:

```sh
AI_ENGINE_URL=http://127.0.0.1:8719
AI_ENGINE_TOKEN=the-same-token
```

Open **Settings > AI engine**, choose an engine and a model, then press **Save**. Saving starts a short lockdown test.

### With Docker

The containers reach the host through `host.docker.internal`, which `compose.yaml` already maps. A service on `127.0.0.1` isn't reachable from a container, so bind it to the Docker bridge address. Any container on that bridge can then reach the port, so the token is what protects it. Setting one of `AI_ENGINE_URL` or `AI_ENGINE_TOKEN` without the other stops AI until you fix it.

```sh
AI_ENGINE_HOST=172.17.0.1 node services/ai-engine/server.mjs
```

```sh
# In deploy/standalone/.env
AI_ENGINE_URL=http://host.docker.internal:8719
AI_ENGINE_TOKEN=the-same-token
```

Restart with `docker compose up -d` so the values are picked up.

### Keep it running with systemd

```ini
[Unit]
Description=SEO Pilot AI engine
After=network.target docker.service

[Service]
User=seo-pilot-ai
WorkingDirectory=/opt/seo-pilot
EnvironmentFile=/etc/seo-pilot-ai-engine.env
ExecStart=/usr/bin/node services/ai-engine/server.mjs
Restart=on-failure
# Each start runs a lockdown test, which uses your plan.
RestartSec=60
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/home/seo-pilot-ai

[Install]
WantedBy=multi-user.target
```

Keep the token in `/etc/seo-pilot-ai-engine.env`, readable only by root:

```sh
AI_ENGINE_TOKEN=the-token
```

These settings limit where the service can write. They don't limit its network, and they don't stop a process reading the token from the service's environment. This unit hasn't been tested on Linux yet.

## Settings

| Variable                                                              | Default                             | Meaning                                |
| --------------------------------------------------------------------- | ----------------------------------- | -------------------------------------- |
| `AI_ENGINE_TOKEN`                                                     | none, required                      | Bearer token, 32 characters or more    |
| `AI_ENGINE_HOST`                                                      | `127.0.0.1`                         | Address to listen on                   |
| `AI_ENGINE_PORT`                                                      | `8719`                              | Port                                   |
| `AI_ENGINE_STATE_FILE`                                                | `~/.seo-pilot-ai-engine/state.json` | Where the chosen engine and model live |
| `AI_ENGINE_AGY_PATH`, `AI_ENGINE_CLAUDE_PATH`, `AI_ENGINE_CODEX_PATH` | found on `PATH`                     | Absolute path to each tool             |
| `AI_ENGINE_JOB_TIMEOUT_MS`                                            | `180000`                            | Longest one job can run                |
| `AI_ENGINE_LOCKDOWN_TIMEOUT_MS`                                       | `120000`                            | Longest one lockdown test can run      |
| `AI_ENGINE_QUEUE_LIMIT`                                               | `8`                                 | Jobs allowed to wait                   |
| `AI_ENGINE_QUEUE_WAIT_MS`                                             | `120000`                            | Longest a job can wait                 |
| `AI_ENGINE_MAX_INPUT_BYTES`                                           | `2097152`                           | Largest request                        |
| `AI_ENGINE_MAX_OUTPUT_BYTES`                                          | `4194304`                           | Largest reply before the job is ended  |

## Security

These tools are built to read files, run commands and browse. SEO Pilot gives them page text from the open web, so a page could try to talk one into doing that. The service removes those abilities and checks that they stayed removed.

**The service**

- Listens on loopback unless you say otherwise, and every route needs the token, compared in constant time.
- Runs fixed binaries with fixed arguments and no shell, in a new private temporary folder each time.
- Passes a minimal environment, so an API key in its own environment can't silently be billed.
- Sends the prompt on stdin, so it never appears in the argument list.
- Runs one job at a time with a small queue, a size limit each way, and a timeout. A hung job is killed along with its process group. A process that leaves the group can't be killed from here, so if one holds the tool's output open, the engine is turned off.
- Logs only event names, durations and fixed codes, never prompts, replies or tokens. It doesn't repeat a tool's error text, because that text can quote the prompt.

**The lockdown test**

An engine can run only after it passes a test against the binary on disk and the chosen model. The binary is identified by its path, date and size, and for a script, by the same details of its whole package. Config files aren't covered, and neither is anything a wrapper script starts from outside its package. The test runs on startup for the chosen engine, when you switch to an engine or model with no current pass, when you press **Test**, and whenever the binary changes. Through the same code path as real work, it asks the engine to read a planted file, run a command, and fetch a local and a public page. The engine is blocked if any of these work, if it reports using any tool, or if it can't finish the test. A failed test holds until you press **Test** or the binary changes.

A pass shows that no step worked. A model can also pass by not trying, so each tool needs other evidence too, and the test doesn't tell the model it has no tools. `claude` lists the tools it was offered. `agy` reports the agent it loaded and a context too small to hold the default tools. `codex` reports neither, which is why it's marked not verified.

Every job is checked again right before it starts, not only when it joins the queue. During real work, an engine that reports using a tool has its reply thrown away and is turned off, even if the job then hangs, floods its output or is cancelled.

Versions outside the known-good list show a warning, and the test still decides whether they run.

**Each tool**

| Tool                   | Known good   | How it's locked                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agy`                  | 1.5.0, 1.5.2 | A custom agent with only the `finish` tool, plus deny rules for files, commands, URLs and MCP. The deny rules alone are not enough: they don't stop `search_web` or subagent creation, and `--sandbox` and `--mode plan` don't block tools either. The agent also cuts the context from about 24,000 tokens to about 700. |
| `claude`               | 2.1.318      | `--tools ""`, `--restricted`, `--safe-mode`, `--strict-mcp-config`, no session files, no settings files and no hooks. Every run also checks the tool list it reports at startup. `--bare` isn't used, because it doesn't read a subscription login.                                                                       |
| `codex` (not verified) | 0.162.1      | `codex exec` with the shell, web search, MCP, plugins and other tool features turned off, and no saved session. Passed one real lockdown test, but it doesn't report which tools it was offered, so the result also relies on it trying the steps. Treat it as not verified.                                              |

`agy` needs one small file in its otherwise empty working folder: the agent definition. The `codex` sandbox is `read-only`, which still allows reads, so the protection there is the disabled tools, not the sandbox.

**Inside SEO Pilot**

App tools still work. The app lists them in the prompt and asks for a JSON reply: either text or tool calls. Each call is checked against that tool's schema, and anything else is refused. Only the app's existing tools can be called, and they run under the same permission checks as on any other route. Page text stays marked as data.

AI stops instead of falling back to the API key if `AI_ENGINE_URL` or `AI_ENGINE_TOKEN` is set but the pair is incomplete or invalid, if the service can't be reached, or if its saved choice can't be read. Remove both settings to go back to the API key.

With accounts (`AUTH_MODE=password`), only the first account on the installation can see or change the engine, because the choice applies to every organization.

## Cost and records

Subscription runs have no per-call cost, so nothing is charged or metered. Records say "included in subscription" and name the engine and model that ran. They never show a made-up price. If you signed a tool in with an API key rather than a subscription, your provider bills that key, and the records can't tell. Other services a run uses, such as DataForSEO, still report their own cost.

## Limits

- Replies arrive in one piece, not word by word.
- Each model step starts the tool again, so long SAM chats are slower than on an API key.
- `maxOutputTokens` and `temperature` aren't passed to the tools. The output size limit still applies.
- Images and files in a chat aren't sent to the tools.
- Cloudflare Workers deployments can't reach a service on your own loopback address. This route is for the Docker and local editions.
