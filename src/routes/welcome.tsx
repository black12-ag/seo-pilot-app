import { createFileRoute } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingPage } from "@/client/features/public-site/landing/LandingPage";
import landingCss from "@/client/features/public-site/landing/landing.css?raw";

// Public static document, like the existing raw report routes: it bypasses
// the private ClientOnly shell without changing any workspace or API gate.
export const Route = createFileRoute("/welcome")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          "<!doctype html>" +
            renderToStaticMarkup(
              <html lang="en">
                <head>
                  <meta charSet="utf-8" />
                  <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                  />
                  <title>
                    SEO Pilot — Free, open-source SEO and AI-search workspace
                  </title>
                  <meta
                    name="description"
                    content="Self-hosted SEO and AI-search workspace: site audits, Google rankings and keyword ideas from Search Console, free backlinks and AI visibility. Install it with one command."
                  />
                  <meta name="theme-color" content="#f3f1ea" />
                  <meta
                    property="og:title"
                    content="SEO Pilot — Your own SEO and AI-search workspace"
                  />
                  <meta
                    property="og:description"
                    content="Audits, real Google rankings, keyword ideas, backlinks and AI visibility. Free, open source, on your own server."
                  />
                  <meta property="og:type" content="website" />
                  <link
                    rel="icon"
                    type="image/svg+xml"
                    href="/seo-pilot-mark.svg"
                  />
                  <link
                    rel="preload"
                    href="/fonts/anton-400.woff2"
                    as="font"
                    type="font/woff2"
                    crossOrigin=""
                  />
                  <link
                    rel="preload"
                    href="/fonts/onest-variable.woff2"
                    as="font"
                    type="font/woff2"
                    crossOrigin=""
                  />
                  <style>{landingCss}</style>
                  <script src="/landing-init.js" />
                </head>
                <body className="public-landing">
                  <LandingPage />
                  <script type="module" src="/landing.js" />
                </body>
              </html>,
            ),
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "public, max-age=0, must-revalidate",
              "Content-Security-Policy":
                "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
              "X-Content-Type-Options": "nosniff",
              "Referrer-Policy": "strict-origin-when-cross-origin",
            },
          },
        ),
    },
  },
});
