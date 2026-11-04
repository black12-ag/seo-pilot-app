import { z } from "zod";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { publicFetch } from "@/server/lib/public-fetch";
import { readBoundedText } from "@/server/lib/read-bounded-text";
import { getOptionalEnvValue, getWorkersEnv } from "@/server/lib/runtime-env";
import { inertTitle, sameTitle } from "./wordpressDraft";

export type WordPressSite = {
  origin: string;
  username: string;
  applicationPassword: string;
  /** Asked right before each request. False means the password stays here. */
  stillAllowed: (mutating: boolean) => Promise<boolean>;
};

/**
 * `rejected` means WordPress or our own policy refused, so nothing was applied.
 * `lost` means the outcome is unknown and the site must be queried before any
 * further write. Remote text never travels past this file except a checked code.
 */
export type WordPressRejection = {
  kind: "rejected";
  status: number | null;
  code: string;
};
type WordPressReply<T> =
  | { kind: "ok"; value: T }
  | WordPressRejection
  | { kind: "lost" };

const ACCESS_WITHDRAWN = "access_withdrawn";

// Only WordPress saying so proves a post is gone. A firewall or proxy can answer
// 404 for a post that is still there.
export const postIsGone = (reply: WordPressRejection) =>
  reply.status === 404 && reply.code === "rest_post_invalid_id";

export const accessWithdrawn = (reply: WordPressRejection) =>
  reply.code === ACCESS_WITHDRAWN;

// A proxy can give up on a request the site is still working on.
const MAY_STILL_ARRIVE = new Set([408, 499]);

const MAX_REPLY_BYTES = 4_000_000;
const READ_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 30_000;
const POST_FIELDS = "id,status,slug,modified_gmt,title,content";
const SEARCHABLE_STATUSES = "draft,pending,private,publish,future,trash";
const SEARCH_PAGE_SIZE = 20;

const currentUserSchema = z.object({
  id: z.number().int().positive(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});
const createdPostSchema = z.object({ id: z.number().int().positive() });
const postSchema = z.object({
  id: z.number().int().positive(),
  status: z.string().max(40),
  slug: z.string(),
  modified_gmt: z.string().min(1).max(40),
  title: z.object({ raw: z.string() }),
  content: z.object({ raw: z.string() }),
});
export type WordPressPost = z.infer<typeof postSchema>;
const revisionsSchema = z.array(z.object({ id: z.number().int().positive() }));

/**
 * The crawl gateway that keeps a standalone install DNS-pinned allows GET and
 * HEAD only and strips Authorization on purpose, so it cannot carry these calls.
 * Only the Workers runtime, whose fetch is strictly public, can make them today.
 */
export async function wordPressTransportAvailable() {
  const gateway = await getOptionalEnvValue("CRAWL_GATEWAY_URL");
  const workers = await getWorkersEnv();
  return !gateway && Boolean(workers) && import.meta.env.MODE !== "standalone";
}

function basicAuth(site: WordPressSite) {
  const bytes = new TextEncoder().encode(
    `${site.username}:${site.applicationPassword}`,
  );
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

function rejectionCode(text: string | null) {
  try {
    const code = z
      .object({ code: z.string().regex(/^[a-z0-9_]{1,64}$/) })
      .parse(JSON.parse(text ?? ""));
    return code.code;
  } catch {
    return "remote_error";
  }
}

async function send<T>(
  site: WordPressSite,
  schema: z.ZodType<T>,
  options: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    query?: Record<string, string>;
    body?: unknown;
  },
): Promise<WordPressReply<T>> {
  const url = new URL(options.path, site.origin);
  for (const [name, value] of Object.entries(options.query ?? {}))
    url.searchParams.set(name, value);
  if (url.origin !== site.origin || url.protocol !== "https:")
    return { kind: "rejected", status: null, code: "blocked_target" };
  try {
    if ((await normalizeAndValidateStartUrl(url.href)) !== url.href)
      return { kind: "rejected", status: null, code: "blocked_target" };
  } catch {
    return { kind: "rejected", status: null, code: "blocked_target" };
  }
  if (!(await site.stillAllowed(options.method !== "GET")))
    return { kind: "rejected", status: null, code: ACCESS_WITHDRAWN };
  const timeout = AbortSignal.timeout(
    options.method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await publicFetch(url, {
      method: options.method,
      // Following a redirect would hand the password to another address.
      redirect: "manual",
      credentials: "omit",
      headers: {
        Authorization: basicAuth(site),
        Accept: "application/json",
        "user-agent": "SEO-Pilot-Publishing/1.0",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: timeout,
    });
  } catch {
    return { kind: "lost" };
  }
  if (response.status >= 300 && response.status < 400) {
    void response.body?.cancel().catch(() => {});
    return { kind: "rejected", status: response.status, code: "redirect" };
  }
  let text: string | null;
  try {
    text = await readBoundedText(response, MAX_REPLY_BYTES, timeout);
  } catch {
    return { kind: "lost" };
  }
  // A server error can come after the insert committed, so it proves nothing.
  // 501 is how WordPress says a site has its trash turned off: nothing happened.
  if (
    (response.status >= 500 && response.status !== 501) ||
    MAY_STILL_ARRIVE.has(response.status)
  )
    return { kind: "lost" };
  if (response.status >= 400)
    return {
      kind: "rejected",
      status: response.status,
      code: rejectionCode(text),
    };
  try {
    return { kind: "ok", value: schema.parse(JSON.parse(text ?? "")) };
  } catch {
    return { kind: "lost" };
  }
}

export function getCurrentWordPressUser(site: WordPressSite) {
  return send(site, currentUserSchema, {
    method: "GET",
    path: "/wp-json/wp/v2/users/me",
    query: { context: "edit" },
  });
}

export function createWordPressDraft(
  site: WordPressSite,
  draft: { title: string; html: string; slug: string },
) {
  return send(site, createdPostSchema, {
    method: "POST",
    path: "/wp-json/wp/v2/posts",
    body: {
      title: draft.title,
      content: draft.html,
      status: "draft",
      ...(draft.slug ? { slug: draft.slug } : {}),
    },
  });
}

export function getWordPressPost(site: WordPressSite, postId: number) {
  return send(site, postSchema, {
    method: "GET",
    path: `/wp-json/wp/v2/posts/${postId}`,
    query: { context: "edit", _fields: POST_FIELDS },
  });
}

/**
 * Finds what an earlier attempt may have created. Core REST has no idempotency
 * support, so each draft carries a marker. The search can be replaced by a site
 * plugin, and a site can strip the marker, so the post's own slug is queried too
 * (or its title when it has no slug). A post only counts as ours if its stored
 * content holds the marker. One that matches without it may still be ours, and a
 * full page may hide more, so either makes the result `ambiguous`: not proof of
 * absence. Any failed probe means we do not know.
 */
export async function findWordPressPostsByMarker(
  site: WordPressSite,
  marker: string,
  draft: { title: string; slug: string },
): Promise<WordPressReply<{ posts: WordPressPost[]; ambiguous: boolean }>> {
  const { title, slug } = draft;
  const shared = {
    context: "edit",
    status: SEARCHABLE_STATUSES,
    per_page: String(SEARCH_PAGE_SIZE),
    _fields: POST_FIELDS,
  };
  const queries = [
    { ...shared, search: marker },
    slug ? { ...shared, slug } : { ...shared, search: inertTitle(title) },
  ];
  const found = new Map<number, WordPressPost>();
  let ambiguous = false;
  for (const query of queries) {
    const reply = await send(site, z.array(postSchema), {
      method: "GET",
      path: "/wp-json/wp/v2/posts",
      query,
    });
    if (reply.kind !== "ok") return reply;
    if (reply.value.length >= SEARCH_PAGE_SIZE) ambiguous = true;
    for (const post of reply.value) {
      if (post.content.raw.includes(marker)) found.set(post.id, post);
      else if (slug ? post.slug === slug : sameTitle(post.title.raw, title))
        ambiguous = true;
    }
  }
  return { kind: "ok", value: { posts: [...found.values()], ambiguous } };
}

/** Sites can turn revisions off, so an empty or refused list is not an error. */
export async function latestWordPressRevisionId(
  site: WordPressSite,
  postId: number,
) {
  const reply = await send(site, revisionsSchema, {
    method: "GET",
    path: `/wp-json/wp/v2/posts/${postId}/revisions`,
    query: { per_page: "1", _fields: "id" },
  });
  return reply.kind === "ok" ? (reply.value[0]?.id ?? null) : null;
}

/** Without `force`, WordPress moves the post to trash and can restore it. */
export function trashWordPressPost(site: WordPressSite, postId: number) {
  return send(site, createdPostSchema, {
    method: "DELETE",
    path: `/wp-json/wp/v2/posts/${postId}`,
  });
}
