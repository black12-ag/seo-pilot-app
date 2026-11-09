import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = join(__dirname, "..");

function checkout() {
  const dir = mkdtempSync(join(tmpdir(), "seo-pilot-install-"));
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "deploy/standalone"), { recursive: true });
  for (const file of [
    "scripts/install.sh",
    "deploy/standalone/compose.yaml",
    "deploy/standalone/.env.example",
  ]) {
    copyFileSync(join(repo, file), join(dir, file));
  }
  return dir;
}

function install(dir: string, ...args: string[]) {
  return installWith(dir, process.env.PATH ?? "", ...args);
}

function installWith(dir: string, path: string, ...args: string[]) {
  return execFileSync(
    "sh",
    [join(dir, "scripts/install.sh"), "--dry-run", ...args],
    {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, HOME: dir, PATH: path },
    },
  );
}

function settings(dir: string) {
  const values = new Map<string, string>();
  for (const line of readFileSync(
    join(dir, "deploy/standalone/.env"),
    "utf8",
  ).split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

describe("install.sh", () => {
  it("writes a working first-run .env and pulls the published image", () => {
    const dir = checkout();
    const output = install(dir);
    const env = settings(dir);
    expect(env.get("STORAGE_SECRET_KEY")).toMatch(/^[0-9a-f]{64}$/);
    expect(env.get("SEO_PILOT_IMAGE")).toBe(
      "ghcr.io/black12-ag/seo-pilot-app:latest",
    );
    expect(env.get("BETTER_AUTH_URL")).toBe("http://localhost:3001");
    expect(output).toContain("compose --project-name seo-pilot");
    expect(output).toMatch(/\+ docker compose .* pull/);
    expect(output).not.toContain("compose.build.yaml");
  });

  it("keeps settings already filled in and applies --url, --port and --build", () => {
    const dir = checkout();
    install(dir);
    const first = settings(dir).get("STORAGE_SECRET_KEY");
    const output = install(
      dir,
      "--url",
      "https://seo.example.com/",
      "--port",
      "4000",
      "--build",
    );
    const env = settings(dir);
    expect(env.get("STORAGE_SECRET_KEY")).toBe(first);
    expect(env.get("BETTER_AUTH_URL")).toBe("https://seo.example.com");
    expect(env.get("PORT")).toBe("4000");
    expect(env.get("SEO_PILOT_IMAGE")).toBe("seo-pilot-platform:local");
    expect(output).toContain("compose.build.yaml");
    expect(output).toContain("up -d --build");
  });

  it("refuses unknown options and a bad port", () => {
    const dir = checkout();
    expect(() => install(dir, "--nope")).toThrow();
    expect(() => install(dir, "--port", "80a")).toThrow();
  });

  it("--with-ai sets a private token and the engine address", () => {
    const dir = checkout();
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "agy"), "#!/bin/sh\n");
    chmodSync(join(bin, "agy"), 0o755);
    const output = installWith(
      dir,
      `${bin}:${process.env.PATH ?? ""}`,
      "--with-ai",
    );
    const env = settings(dir);
    expect(env.get("AI_ENGINE_TOKEN")).toMatch(/^[0-9a-f]{64}$/);
    expect(env.get("AI_ENGINE_URL")).toBe("http://host.docker.internal:8719");
    expect(output).toContain("(agy)");
  });

  it("follows a changed --port when the address is still local", () => {
    const dir = checkout();
    install(dir);
    install(dir, "--port", "4100");
    expect(settings(dir).get("BETTER_AUTH_URL")).toBe("http://localhost:4100");
  });
});
