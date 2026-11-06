import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// The project's old name must not come back. Each entry below is an exact piece
// of text that has to keep it. This file holds the list, so it is not scanned.
const ALLOWED = [
  // The Compose project (so existing volume names), the Worker celld runs, its
  // D1 database and its R2 bucket. A new name would start with no data.
  "openseo-standalone",
  // The bucket holding the runtime's state in an install's existing storage.
  "CELLD_BUCKET: openseo",
  // The Every App id. The gateway names the Worker, D1, KV and R2 after it.
  'id: "openseo"',
  // The same id, in the command the crawler-access form shows.
  "--app openseo",
  // Old setting names, read as a fallback so an existing server keeps working:
  // secrets.json and .env.selfhost hold the operator secret under this name.
  "OPENSEO_OPERATOR_SECRET",
  "x-openseo-operator-secret",
  // Old names in an existing server's .env and environment.
  "OPENSEO_IMAGE",
  "OPENSEO_URL",
  // A visitor's saved privacy choice. Read until it ages out (180 days).
  "openseo_privacy",
];

const OLD_NAME = "openseo";
const THIS_FILE = "scripts/old-name.test.ts";

function remainingMentions() {
  const root = resolve(import.meta.dirname, "..");
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => file && file !== THIS_FILE);

  const mentions: string[] = [];
  for (const file of tracked) {
    if (file.toLowerCase().includes(OLD_NAME)) mentions.push(`${file}: path`);
    const path = resolve(root, file);
    // A file deleted but not yet staged is still listed.
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile()) continue;
    // latin1 so a binary file can't fail the read or hide a match.
    const text = readFileSync(path, "latin1");
    if (!text.toLowerCase().includes(OLD_NAME)) continue;
    text.split("\n").forEach((line, index) => {
      const rest = ALLOWED.reduce(
        (remaining, allowed) => remaining.split(allowed).join(""),
        line,
      );
      if (rest.toLowerCase().includes(OLD_NAME)) {
        mentions.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  return mentions;
}

it("the old name appears only where the allowlist says it must", () => {
  expect(remainingMentions()).toEqual([]);
}, 60_000);
