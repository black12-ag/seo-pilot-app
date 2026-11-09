import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  buildProfiles,
  downloadChunks,
  graphFileUrl,
  latestReleaseFromIndex,
} from "./free-backlinks.mjs";

const FIXTURES = "scripts/celld/runtime/fixtures/free-backlinks";
const vertices = gzipSync(readFileSync(`${FIXTURES}/domain-vertices.txt`));
const edges = gzipSync(readFileSync(`${FIXTURES}/domain-edges.txt`));

// Tiny chunks, so lines and numbers straddle chunk boundaries as they do in a
// real 27 GB stream.
async function* inChunks(bytes: Buffer, size = 5) {
  for (let offset = 0; offset < bytes.length; offset += size)
    yield bytes.subarray(offset, offset + size);
}

function build(domains: string[], rows = 3) {
  return buildProfiles({
    domains,
    rows,
    openVertices: () => inChunks(vertices),
    openEdges: () => inChunks(edges),
  });
}

describe("free backlinks preparation", () => {
  it("counts every referring domain and keeps those with the most hosts", async () => {
    const { profiles } = await build(["mysite.com"]);
    // alpha, beta, gamma, delta and epsilon link to it; its self-link doesn't count.
    expect(profiles).toEqual([
      {
        domain: "mysite.com",
        referringDomains: 5,
        referrers: [
          ["gamma.com", 7],
          ["epsilon.co.uk", 4],
          ["alpha.com", 3],
        ],
      },
    ]);
  });

  it("prepares several domains in one pass and counts absent ones as zero", async () => {
    const { profiles, missing } = await build(
      ["mysite.com", "competitor.com", "absent.com"],
      10,
    );
    expect(missing).toEqual(["absent.com"]);
    expect(profiles).toContainEqual({
      domain: "competitor.com",
      referringDomains: 2,
      referrers: [
        ["gamma.com", 7],
        ["alpha.com", 3],
      ],
    });
    expect(profiles).toContainEqual({
      domain: "absent.com",
      referringDomains: 0,
      referrers: [],
    });
    expect(
      profiles.find((p) => p.domain === "mysite.com")?.referrers,
    ).toHaveLength(5);
  });
});

describe("Common Crawl downloads", () => {
  const url = graphFileUrl("cc-main-2026-aug-sep-oct", "edges");

  it("builds release file addresses and refuses odd release names", () => {
    expect(url.href).toBe(
      "https://data.commoncrawl.org/projects/hyperlinkgraph/cc-main-2026-aug-sep-oct/domain/cc-main-2026-aug-sep-oct-domain-edges.txt.gz",
    );
    expect(() => graphFileUrl("../../elsewhere", "edges")).toThrow();
  });

  it("picks the first release listed on the web graph page", () => {
    const html = `<a href="https://data.commoncrawl.org/projects/hyperlinkgraph/cc-main-2026-aug-sep-oct/index.html">new</a>
      <a href="https://data.commoncrawl.org/projects/hyperlinkgraph/cc-main-2026-jul-aug-sep/index.html">old</a>`;
    expect(latestReleaseFromIndex(html)).toBe("cc-main-2026-aug-sep-oct");
    expect(() => latestReleaseFromIndex("<p>nothing</p>")).toThrow();
  });

  it("resumes a dropped download from where it stopped", async () => {
    const whole = Buffer.from("0123456789");
    const ranges: (string | null)[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const range = new Headers(init?.headers).get("range");
      ranges.push(range);
      if (!range) {
        // Sends four bytes, then the connection drops.
        let sent = false;
        const body = new ReadableStream({
          pull(controller) {
            if (sent) controller.error(new Error("connection reset"));
            else controller.enqueue(whole.subarray(0, 4));
            sent = true;
          },
        });
        return new Response(body, { status: 200 });
      }
      const from = Number(/bytes=(\d+)-/.exec(range)?.[1]);
      return new Response(whole.subarray(from), { status: 206 });
    };
    const received: Buffer[] = [];
    for await (const chunk of downloadChunks(url, {
      fetchImpl,
      retryDelayMs: 0,
    }))
      received.push(chunk);
    expect(Buffer.concat(received).toString()).toBe("0123456789");
    expect(ranges).toEqual([null, "bytes=4-"]);
  });

  it("only downloads from Common Crawl's data host", async () => {
    const elsewhere = downloadChunks(new URL("https://example.com/file.gz"));
    await expect(elsewhere.next()).rejects.toThrow("Refusing");
  });
});
