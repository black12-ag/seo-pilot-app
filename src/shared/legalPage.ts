import { CURRENT_TERMS_EFFECTIVE_DATE } from "@/shared/terms";

export const LEGAL_CONTACT_EMAIL = "support@viral4all.com";

const STYLES =
  "body{font:16px/1.6 system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1rem;color:#111}h2{margin-top:2rem;font-size:1.15rem}table{border-collapse:collapse;width:100%;font-size:.95rem}th,td{border:1px solid #ddd;padding:.5rem;text-align:left;vertical-align:top}";

/** Static legal documents, public so they can be read before signing up. */
export function legalPageResponse(title: string, body: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title} | SEO Pilot</title><style>${STYLES}</style></head><body><h1>${title}</h1><p>Effective ${CURRENT_TERMS_EFFECTIVE_DATE}</p>${body}</body></html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
