// Prepares free, domain-level backlink data from Common Crawl's public web
// graph for the domains this installation tracks (project sites and their
// competitors), then hands the result to the app. See docs/FREE_BACKLINKS.md.
//
// It streams the graph and keeps only what it needs, so it fits a small
// server: about 1 GB of temporary disk for the domain list, a few hundred MB
// of memory, and no copy of the 7 GB link file. One run reads the domain list
// twice from that temporary copy and the link file once from the network.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

const GRAPH_INDEX_URL = "https://commoncrawl.org/web-graphs";
const GRAPH_DATA_BASE = "https://data.commoncrawl.org/projects/hyperlinkgraph/";
// Release names look like cc-main-2026-aug-sep-oct or cc-main-2025-26-dec-jan-feb.
const RELEASE_PATTERN = /^cc-main-\d{4}(?:-\d{2})?(?:-[a-z]{3}){1,4}$/;
/** Referring domains kept per tracked domain (the count covers all of them). */
const DEFAULT_ROWS = 2000;
// Ids held per tracked domain while the link file streams by: 3 million is
// 12 MB, and all domains together hold at most 40 million (160 MB). A domain
// with more referring domains still gets its full count; its listed rows are
// then picked from the ids it held (lowest ids first, which is alphabetical by
// reversed name).
const MAX_IDS_PER_TARGET = 3_000_000;
const MAX_IDS_TOTAL = 40_000_000;
const IDLE_TIMEOUT_MS = 60_000;
const MAX_RESUMES = 20;

/** @param {string} release */
function assertRelease(release) {
  if (!RELEASE_PATTERN.test(release))
    throw new Error(`Not a Common Crawl web graph release name: ${release}`);
  return release;
}

/** @param {string} release @param {"vertices" | "edges"} kind */
export function graphFileUrl(release, kind) {
  assertRelease(release);
  return new URL(
    `${release}/domain/${release}-domain-${kind}.txt.gz`,
    GRAPH_DATA_BASE,
  );
}

/** The newest release on Common Crawl's web graph page, which lists newest first. @param {string} html */
export function latestReleaseFromIndex(html) {
  const match = /\/projects\/hyperlinkgraph\/(cc-main-[a-z0-9-]+)\//.exec(html);
  if (!match || !RELEASE_PATTERN.test(match[1]))
    throw new Error(
      "Could not find a web graph release on commoncrawl.org. Pass --release.",
    );
  return match[1];
}

/** "Example.co.uk" -> "uk.co.example", the graph's reversed form. @param {string} domain */
function reverseDomain(domain) {
  return domain.toLowerCase().split(".").reverse().join(".");
}

/**
 * Calls onLine(buffer, start, end) for each line of a stream of Buffers,
 * without decoding lines nobody asks for.
 * @param {AsyncIterable<Buffer>} chunks
 * @param {(buf: Buffer, start: number, end: number) => void} onLine
 */
async function forEachLine(chunks, onLine) {
  /** @type {Buffer | null} */
  let carry = null;
  for await (const chunk of chunks) {
    const buf = carry ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    let nl = buf.indexOf(10, start);
    while (nl !== -1) {
      onLine(buf, start, nl);
      start = nl + 1;
      nl = buf.indexOf(10, start);
    }
    carry = start < buf.length ? Buffer.from(buf.subarray(start)) : null;
  }
  if (carry && carry.length > 0) onLine(carry, 0, carry.length);
}

/** Parses a run of ASCII digits. @param {Buffer} buf @param {number} start @param {number} end */
function readInt(buf, start, end) {
  let n = 0;
  for (let i = start; i < end; i++) n = n * 10 + (buf[i] - 48);
  return n;
}

/**
 * Pass 1 over the domain list (`id \t reversed domain \t hosts`): the graph id
 * of each tracked domain, and the total number of ids.
 * @param {AsyncIterable<Buffer>} vertexChunks
 * @param {string[]} domains
 */
async function findDomainIds(vertexChunks, domains) {
  const wanted = new Map(domains.map((d) => [reverseDomain(d), d]));
  /** @type {Map<string, number>} */
  const ids = new Map();
  let maxId = -1;
  await forEachLine(vertexChunks, (buf, start, end) => {
    const tab1 = buf.indexOf(9, start);
    if (tab1 === -1 || tab1 >= end) return;
    const id = readInt(buf, start, tab1);
    if (id > maxId) maxId = id;
    const tab2 = buf.indexOf(9, tab1 + 1);
    const nameEnd = tab2 === -1 || tab2 > end ? end : tab2;
    const domain = wanted.get(buf.toString("latin1", tab1 + 1, nameEnd));
    if (domain) ids.set(domain, id);
  });
  return { ids, nodeCount: maxId + 1 };
}

/** @param {number} nodeCount */
function newBitmap(nodeCount) {
  return new Uint8Array(Math.ceil(Math.max(nodeCount, 1) / 8));
}

/**
 * Pass over the link file (`from_id \t to_id`, one line per linking domain
 * pair): who links to each tracked id. Parses bytes directly; the file is
 * about 27 GB once decompressed.
 * @param {AsyncIterable<Buffer>} edgeChunks
 * @param {number[]} targetIds
 * @param {number} nodeCount
 */
async function collectReferrers(edgeChunks, targetIds, nodeCount) {
  const maxIdsPerTarget = Math.min(
    MAX_IDS_PER_TARGET,
    Math.floor(MAX_IDS_TOTAL / Math.max(targetIds.length, 1)),
  );
  const isTarget = newBitmap(nodeCount);
  // Ids live in typed arrays (4 bytes each, outside the JS heap), grown as needed.
  /** @type {Map<number, {count: number, size: number, buf: Uint32Array}>} */
  const growing = new Map();
  for (const id of targetIds) {
    isTarget[id >>> 3] |= 1 << (id & 7);
    growing.set(id, { count: 0, size: 0, buf: new Uint32Array(1024) });
  }
  /** @param {number} from @param {number} to */
  const take = (from, to) => {
    if (to >= nodeCount || (isTarget[to >>> 3] & (1 << (to & 7))) === 0) return;
    const entry = growing.get(to);
    if (!entry || from === to) return;
    entry.count++;
    if (entry.size >= maxIdsPerTarget) return;
    if (entry.size === entry.buf.length) {
      const bigger = new Uint32Array(
        Math.min(maxIdsPerTarget, entry.buf.length * 2),
      );
      bigger.set(entry.buf);
      entry.buf = bigger;
    }
    entry.buf[entry.size++] = from;
  };
  let num = 0;
  let from = 0;
  let open = false;
  for await (const chunk of edgeChunks) {
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i];
      if (b >= 48) {
        num = num * 10 + (b - 48);
        open = true;
      } else if (b === 9) {
        from = num;
        num = 0;
      } else if (b === 10) {
        if (open) take(from, num);
        num = 0;
        open = false;
      }
    }
  }
  if (open) take(from, num);
  /** @type {Map<number, {count: number, ids: Uint32Array}>} */
  const byTarget = new Map();
  for (const [id, entry] of growing)
    byTarget.set(id, {
      count: entry.count,
      ids: entry.buf.subarray(0, entry.size),
    });
  return byTarget;
}

/**
 * Pass 2 over the domain list: names and host counts of the referring ids,
 * keeping the `rows` with the most hosts per tracked domain.
 * @param {AsyncIterable<Buffer>} vertexChunks
 * @param {Map<number, {count: number, ids: Uint32Array}>} byTarget
 * @param {number} nodeCount
 * @param {number} rows
 */
async function resolveReferrers(vertexChunks, byTarget, nodeCount, rows) {
  const needed = newBitmap(nodeCount);
  const targets = [...byTarget.entries()].map(([id, entry]) => {
    // The link file is sorted by source id, so each list is already ascending.
    for (const ref of entry.ids) needed[ref >>> 3] |= 1 << (ref & 7);
    /** @type {[string, number][]} */
    const kept = [];
    return { id, ids: entry.ids, next: 0, kept };
  });
  /** @param {[string, number][]} kept */
  const trim = (kept) => {
    kept.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    kept.length = Math.min(kept.length, rows);
  };
  await forEachLine(vertexChunks, (buf, start, end) => {
    const tab1 = buf.indexOf(9, start);
    if (tab1 === -1 || tab1 >= end) return;
    const id = readInt(buf, start, tab1);
    if (id >= nodeCount || (needed[id >>> 3] & (1 << (id & 7))) === 0) return;
    const tab2 = buf.indexOf(9, tab1 + 1);
    const nameEnd = tab2 === -1 || tab2 > end ? end : tab2;
    const domain = reverseDomain(buf.toString("latin1", tab1 + 1, nameEnd));
    const hosts = nameEnd < end ? readInt(buf, nameEnd + 1, end) : 0;
    for (const target of targets) {
      while (target.next < target.ids.length && target.ids[target.next] < id)
        target.next++;
      if (target.ids[target.next] !== id) continue;
      target.kept.push([domain, hosts]);
      if (target.kept.length >= rows * 2) trim(target.kept);
    }
  });
  /** @type {Map<number, [string, number][]>} */
  const result = new Map();
  for (const target of targets) {
    trim(target.kept);
    result.set(target.id, target.kept);
  }
  return result;
}

/**
 * Bytes of a public Common Crawl file. A dropped connection resumes where it
 * stopped with a range request, so one network blip doesn't restart a 7 GB
 * read.
 * @param {URL} url
 * @param {{fetchImpl?: typeof fetch, log?: (m: string) => void, retryDelayMs?: number}} [options]
 */
export async function* downloadChunks(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => {});
  const retryDelayMs = options.retryDelayMs ?? 2000;
  if (url.origin !== new URL(GRAPH_DATA_BASE).origin)
    throw new Error(`Refusing to download from ${url.origin}`);
  let offset = 0;
  let resumes = 0;
  for (;;) {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        redirect: "error",
        signal: controller.signal,
        headers: offset > 0 ? { range: `bytes=${offset}-` } : {},
      });
      if (offset > 0 ? response.status !== 206 : !response.ok)
        throw new Error(`${url.pathname}: HTTP ${response.status}`);
      if (!response.body) throw new Error(`${url.pathname}: empty response`);
      for await (const chunk of response.body) {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
        offset += chunk.length;
        yield Buffer.from(chunk);
      }
      return;
    } catch (error) {
      if (resumes >= MAX_RESUMES) throw error;
      resumes++;
      log(`Connection dropped at ${offset} bytes; resuming (${resumes}).`);
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelayMs * resumes),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** @param {AsyncIterable<Buffer>} compressed */
function gunzip(compressed) {
  return Readable.from(compressed).pipe(createGunzip());
}

/**
 * Runs the three passes for `domains` over the given compressed sources.
 * @param {{
 *   domains: string[],
 *   rows?: number,
 *   openVertices: () => AsyncIterable<Buffer>,
 *   openEdges: () => AsyncIterable<Buffer>,
 *   log?: (m: string) => void,
 * }} input
 */
export async function buildProfiles(input) {
  const rows = input.rows ?? DEFAULT_ROWS;
  const log = input.log ?? (() => {});
  log(`Finding ${input.domains.length} domains in the graph...`);
  const { ids, nodeCount } = await findDomainIds(
    gunzip(input.openVertices()),
    input.domains,
  );
  const missing = input.domains.filter((d) => !ids.has(d));
  // A domain missing from the list had no links the crawl saw: count zero.
  /** @type {{domain: string, referringDomains: number, referrers: [string, number][]}[]} */
  const none = missing.map((domain) => ({
    domain,
    referringDomains: 0,
    referrers: [],
  }));
  if (ids.size === 0) return { profiles: none, missing };
  log(`Reading links to ${ids.size} domains (the long step)...`);
  const byTarget = await collectReferrers(
    gunzip(input.openEdges()),
    [...ids.values()],
    nodeCount,
  );
  log("Naming the linking domains...");
  const kept = await resolveReferrers(
    gunzip(input.openVertices()),
    byTarget,
    nodeCount,
    rows,
  );
  const profiles = [...ids.entries()].map(([domain, id]) => ({
    domain,
    referringDomains: byTarget.get(id)?.count ?? 0,
    referrers: kept.get(id) ?? [],
  }));
  return { profiles: [...profiles, ...none], missing };
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{domains: string[], release?: string, rows: number, out?: string, workDir?: string}} */
  const args = { domains: [], rows: DEFAULT_ROWS };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--domain" && value) args.domains.push(value);
    else if (flag === "--release" && value) args.release = assertRelease(value);
    else if (flag === "--rows" && value) args.rows = Number(value);
    else if (flag === "--out" && value) args.out = value;
    else if (flag === "--work-dir" && value) args.workDir = value;
    else
      throw new Error(
        "Usage: free-backlinks.mjs [--domain example.com]... [--release NAME] [--rows N] [--out FILE] [--work-dir DIR]",
      );
    i++;
  }
  if (!Number.isInteger(args.rows) || args.rows < 1 || args.rows > 5000)
    throw new Error("--rows must be a whole number from 1 to 5000.");
  return args;
}

async function operatorSecret() {
  const fromEnv =
    process.env.SEO_PILOT_OPERATOR_SECRET ||
    process.env.OPENSEO_OPERATOR_SECRET;
  if (fromEnv) return fromEnv;
  const stored = JSON.parse(await readFile("/config/secrets.json", "utf8"));
  return stored.SEO_PILOT_OPERATOR_SECRET || stored.OPENSEO_OPERATOR_SECRET;
}

/** @param {unknown} body */
async function callApp(body) {
  const baseUrl =
    process.env.SEO_PILOT_URL ||
    process.env.OPENSEO_URL ||
    "http://127.0.0.1:8080";
  const response = await fetch(`${baseUrl}/api/standalone/free-backlinks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-seo-pilot-operator-secret": await operatorSecret(),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `The app refused (${response.status}): ${text.slice(0, 300)}`,
    );
  return JSON.parse(text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  /** @param {string} m */
  const log = (m) => console.error(m);
  /** @type {string[]} */
  const fromApp = args.out
    ? []
    : (await callApp({ command: "targets" })).domains;
  const domains = [
    ...new Set([...fromApp, ...args.domains].map((d) => d.toLowerCase())),
  ];
  if (domains.length === 0) {
    log("No project or competitor domains to prepare yet.");
    return;
  }
  const release =
    args.release ??
    latestReleaseFromIndex(
      await (await fetch(GRAPH_INDEX_URL, { redirect: "error" })).text(),
    );
  const edgesUrl = graphFileUrl(release, "edges");
  const head = await fetch(edgesUrl, { method: "HEAD", redirect: "error" });
  if (!head.ok)
    throw new Error(`${release} has no domain graph (HTTP ${head.status}).`);
  const lastModified = head.headers.get("last-modified");
  const publishedAt = lastModified
    ? new Date(lastModified).toISOString()
    : null;
  log(`Release ${release}, published ${publishedAt ?? "on an unknown date"}.`);

  const workDir = await mkdtemp(
    join(args.workDir ?? tmpdir(), "free-backlinks-"),
  );
  try {
    const verticesFile = join(workDir, "domain-vertices.txt.gz");
    log("Downloading the domain list (about 1 GB)...");
    await pipeline(
      Readable.from(downloadChunks(graphFileUrl(release, "vertices"), { log })),
      createWriteStream(verticesFile),
    );
    const { profiles, missing } = await buildProfiles({
      domains,
      rows: args.rows,
      openVertices: () => createReadStream(verticesFile),
      openEdges: () => downloadChunks(edgesUrl, { log }),
      log,
    });
    if (missing.length > 0)
      log(`Not in this release (no links seen): ${missing.join(", ")}`);
    if (args.out) {
      await writeFile(
        args.out,
        JSON.stringify({ release, publishedAt, profiles }),
      );
      log(`Wrote ${profiles.length} domains to ${args.out}.`);
      return;
    }
    for (const profile of profiles) {
      await callApp({ command: "import", release, publishedAt, profile });
      log(`${profile.domain}: ${profile.referringDomains} referring domains.`);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
