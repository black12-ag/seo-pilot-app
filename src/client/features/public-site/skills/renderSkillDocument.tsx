import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import skillDocsCss from "./skillDocs.css?raw";

// Public, static skill documentation: no scripts, no app shell.
export function renderSkillDocument(input: {
  title: string;
  description: string;
  canonical: string;
  body: ReactNode;
}) {
  const html =
    "<!doctype html>" +
    renderToStaticMarkup(
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{input.title}</title>
          <meta name="description" content={input.description} />
          <link rel="canonical" href={input.canonical} />
          <meta property="og:title" content={input.title} />
          <meta property="og:description" content={input.description} />
          <meta property="og:type" content="article" />
          <meta property="og:url" content={input.canonical} />
          <meta
            property="og:image"
            content={`${new URL(input.canonical).origin}/og-image.png`}
          />
          <meta name="theme-color" content="#f3f1ea" />
          <link rel="icon" type="image/svg+xml" href="/seo-pilot-mark.svg" />
          <style>{skillDocsCss}</style>
        </head>
        <body>{input.body}</body>
      </html>,
    );
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}
