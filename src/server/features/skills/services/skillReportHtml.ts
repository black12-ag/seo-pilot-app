import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Plain, printable, self-contained: no external requests, no scripts.
const STYLE = `body{font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a1a1a;max-width:860px;margin:2rem auto;padding:0 1.25rem}
h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1.2rem;margin-top:1.75rem}h3{font-size:1.05rem}
.meta{color:#666;font-size:.85rem;margin-bottom:1.5rem}
table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.9rem}th,td{border:1px solid #ddd;padding:.4rem .6rem;text-align:left;vertical-align:top}th{background:#f6f6f6}
code{background:#f3f3f3;padding:0 .25rem;border-radius:3px}pre{background:#f6f6f6;padding:.75rem;overflow:auto}
a{color:#1c4ed8}blockquote{border-left:3px solid #ddd;margin:0;padding-left:1rem;color:#555}`;

/**
 * A scheduled run's reply as a report document. The reply is model output, so
 * it stays inert: the Markdown renderer escapes raw HTML and drops unsafe link
 * schemes, and the title is escaped here.
 */
export function renderSkillReportHtml(input: {
  title: string;
  subtitle: string;
  markdown: string;
}): string {
  const body = renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm] }, input.markdown),
  );
  const title = escapeHtml(input.title);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head>
<body><h1>${title}</h1><p class="meta">${escapeHtml(input.subtitle)}</p>
${body}
</body></html>`;
}
