import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sha256Hex } from "@/server/lib/audit/ids";
import type { WordPressPost } from "./wordpressClient";

/** Same site and revision always gives the same key, so it can only be sent once. */
export function wordPressIdempotencyKey(input: {
  projectId: string;
  contentId: string;
  revisionId: string;
  origin: string;
}) {
  return sha256Hex(
    [
      "wordpress-draft-v1",
      input.projectId,
      input.contentId,
      input.revisionId,
      input.origin,
    ].join("\n"),
  );
}

export const wordPressMarker = (idempotencyKey: string) =>
  `seopilot${idempotencyKey.slice(0, 32)}`;

// WordPress may rewrite line endings and ampersands when it saves. Anything
// beyond that is a real difference and gets reported.
function comparable(value: string) {
  return value.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

const hashHtml = (html: string) => sha256Hex(comparable(html));

/**
 * WordPress prints a title as HTML and stores it as sent for admins, so it goes
 * out as escaped text. Quotes stay as they are: they are inert in element text,
 * and WordPress rewrites numeric entities, which a read back would call an edit.
 */
export const inertTitle = (title: string) =>
  title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Whether a title stored on the site is the one we send for `title`. */
export const sameTitle = (stored: string, title: string) =>
  comparable(stored) === comparable(inertTitle(title));

/** Erasure empties the content hash, and a real hash is never empty. */
export const recordErased = (record: { contentHash: string }) =>
  record.contentHash === "";

/**
 * Untrusted text stays inert: the renderer escapes raw HTML and strips unsafe
 * link schemes. The marker is appended afterwards, so page text cannot forge it.
 */
export async function buildWordPressDraft(
  source: { title: string; slug: string; markdown: string },
  idempotencyKey: string,
) {
  const body = renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm] }, source.markdown),
  );
  const html = `${body}\n<!-- ${wordPressMarker(idempotencyKey)} -->`;
  return {
    title: source.title.trim(),
    slug: source.slug.trim().toLowerCase(),
    html,
    contentHash: await hashHtml(html),
  };
}

/** Compares what the site stored with what was intended to be there. */
export async function compareWordPressPost(
  expected: { title: string; slug: string; contentHash: string },
  post: WordPressPost,
) {
  const contentHash = await hashHtml(post.content.raw);
  const mismatches = [
    ...(sameTitle(post.title.raw, expected.title) ? [] : ["title"]),
    ...(contentHash === expected.contentHash ? [] : ["content"]),
    ...(post.status === "draft" ? [] : ["status"]),
    ...(expected.slug && post.slug !== expected.slug ? ["slug"] : []),
  ];
  return { contentHash, mismatches };
}

/**
 * Whether the post on the site is still exactly what we last read back. A
 * baseline is only stored by a read back that matched the record's title and
 * slug, so those are part of it. The timestamp has one-second resolution, and a
 * site that keeps revisions adds one on an edit, so a revision that appeared or
 * went away means this can't be shown to be unchanged.
 */
export async function unchangedSinceLastWrite(
  last: {
    title: string;
    slug: string;
    remoteModifiedGmt: string | null;
    remoteContentHash: string | null;
    remoteRevisionId: number | null;
  },
  post: WordPressPost,
  revisionId: number | null,
) {
  return (
    last.remoteModifiedGmt !== null &&
    last.remoteContentHash !== null &&
    post.modified_gmt === last.remoteModifiedGmt &&
    sameTitle(post.title.raw, last.title) &&
    post.slug === last.slug &&
    revisionId === last.remoteRevisionId &&
    (await hashHtml(post.content.raw)) === last.remoteContentHash
  );
}
