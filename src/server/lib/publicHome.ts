// A visitor with no session who opens "/" gets the public landing page
// instead of an empty app shell that only sends them to sign-in. Signed-in
// people (any session cookie) still go straight to the app, which checks the
// session itself.
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/;

export function publicHomeRedirect(
  request: Request,
  publicUrl: string,
  authMode: string,
): Response | null {
  if (authMode !== "password" || request.method !== "GET") return null;
  if (new URL(publicUrl).pathname !== "/") return null;
  if (SESSION_COOKIE.test(request.headers.get("cookie") ?? "")) return null;
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/welcome",
      "Cache-Control": "no-store",
      Vary: "Cookie",
    },
  });
}
