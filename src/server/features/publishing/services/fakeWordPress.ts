import { z } from "zod";

type Post = {
  id: number;
  status: string;
  slug: string;
  modified_gmt: string;
  title: { raw: string };
  content: { raw: string };
};
type CreateMode =
  | "ok"
  | "reject"
  | "lost_before_insert"
  | "lost_after_insert"
  | "proxy_timeout_after_insert";
type TrashMode = "ok" | "reject" | "lost_after_trash";

const draftBody = z.object({
  title: z.string(),
  content: z.string(),
  status: z.string(),
  slug: z.string().default(""),
});

const dnsAnswer = (url: URL) =>
  Response.json({
    Status: 0,
    Question: [{ name: url.searchParams.get("name"), type: 1 }],
    Answer: [
      {
        name: url.searchParams.get("name"),
        type: 1,
        TTL: 60,
        data: "93.184.216.34",
      },
    ],
  });

/** A small in-memory WordPress REST API, for tests that must not touch a site. */
export function fakeWordPress(origin: string) {
  let pending: {
    matches: (url: URL, method: string) => boolean;
    action: () => Promise<unknown>;
  } | null = null;
  const site = {
    posts: [] as Post[],
    creates: 0,
    trashes: 0,
    searches: 0,
    userReads: 0,
    authorization: null as string | null,
    nextCreate: "ok" as CreateMode,
    nextTrash: "ok" as TrashMode,
    failReads: false,
    firewallNotFound: false,
    rejectAuth: false,
    latestRevision: 900 as number | null,
    capabilities: { edit_posts: true, delete_posts: true } as Record<
      string,
      boolean
    >,
    filterContent: (html: string) => html,
    /** Runs `action` as the first matching request arrives, before it's handled. */
    whenRequest(
      matches: (url: URL, method: string) => boolean,
      action: () => Promise<unknown>,
    ) {
      pending = { matches, action };
    },
    duplicateLast() {
      const last = site.posts.at(-1);
      if (last) site.posts.push({ ...last, id: last.id + 1 });
    },
    ownerEdit() {
      const post = site.posts[0];
      if (!post) return;
      post.content.raw += "<p>owner edit</p>";
      post.modified_gmt = "2026-02-02T00:00:00";
    },
    ownerPublish() {
      if (site.posts[0]) site.posts[0].status = "publish";
    },
    ownerReplace() {
      if (site.posts[0]) site.posts[0].content.raw = "<p>Replaced</p>";
    },
    ownerDelete() {
      site.posts.length = 0;
    },
    fetch: async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "cloudflare-dns.com") {
        return url.searchParams.get("type") === "AAAA"
          ? Response.json({ Status: 0, Answer: [] })
          : dnsAnswer(url);
      }
      if (url.origin !== origin) throw new Error(`Unexpected ${url.href}`);
      site.authorization = new Headers(init?.headers).get("Authorization");
      const method = init?.method ?? "GET";
      if (pending?.matches(url, method)) {
        const { action } = pending;
        pending = null;
        await action();
      }
      if (method === "GET" && site.failReads)
        return new Response("Bad gateway", { status: 502 });
      if (site.rejectAuth)
        return Response.json(
          { code: "incorrect_password", message: "Secret detail" },
          { status: 401 },
        );
      const path = url.pathname.replace("/wp-json/wp/v2", "");
      if (path === "/users/me") {
        site.userReads += 1;
        return Response.json({ id: 1, capabilities: site.capabilities });
      }
      if (path === "/posts" && method === "POST") return create(init);
      if (path === "/posts") return search(url);
      const revisions = /^\/posts\/(\d+)\/revisions$/.exec(path);
      if (revisions)
        return Response.json(
          site.latestRevision === null ? [] : [{ id: site.latestRevision }],
        );
      const single = /^\/posts\/(\d+)$/.exec(path);
      if (single) {
        if (site.firewallNotFound)
          return new Response("<html>Not found</html>", { status: 404 });
        const post = site.posts.find((p) => p.id === Number(single[1]));
        if (!post)
          return Response.json(
            { code: "rest_post_invalid_id" },
            { status: 404 },
          );
        return method === "DELETE" ? trash(post) : Response.json(post);
      }
      throw new Error(`Unexpected ${method} ${url.href}`);
    },
  };

  function create(init?: RequestInit) {
    site.creates += 1;
    const mode = site.nextCreate;
    site.nextCreate = "ok";
    if (mode === "reject")
      return Response.json(
        { code: "rest_cannot_create", message: "Secret detail" },
        { status: 403 },
      );
    if (mode === "lost_before_insert") throw new Error("Connection lost");
    const body = draftBody.parse(
      JSON.parse(typeof init?.body === "string" ? init.body : "{}"),
    );
    const post: Post = {
      id: 100 + site.posts.length,
      status: body.status,
      slug: body.slug,
      modified_gmt: "2026-01-01T00:00:00",
      title: { raw: body.title },
      content: { raw: site.filterContent(body.content) },
    };
    site.posts.push(post);
    if (mode === "lost_after_insert")
      return new Response("Gateway timeout", { status: 504 });
    if (mode === "proxy_timeout_after_insert")
      return new Response("Request timeout", { status: 408 });
    return Response.json({ id: post.id });
  }

  function search(url: URL) {
    site.searches += 1;
    const term = url.searchParams.get("search");
    const slug = url.searchParams.get("slug");
    return Response.json(
      site.posts.filter((post) =>
        term
          ? post.content.raw.includes(term) || post.title.raw.includes(term)
          : post.slug === slug,
      ),
    );
  }

  function trash(post: Post) {
    site.trashes += 1;
    const mode = site.nextTrash;
    site.nextTrash = "ok";
    if (mode === "reject")
      return Response.json(
        { code: "rest_trash_not_supported" },
        { status: 501 },
      );
    post.status = "trash";
    if (mode === "lost_after_trash")
      return new Response("Gateway timeout", { status: 504 });
    return Response.json({ id: post.id });
  }

  return site;
}

export type FakeWordPress = ReturnType<typeof fakeWordPress>;
