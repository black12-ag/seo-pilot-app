import { z } from "zod";

/** Longest question a link may preload into SAM's composer. */
export const SAM_ASK_MAX_LENGTH = 1000;

// Control characters other than tab and newline, and the bidi overrides that
// can make text read differently from what is sent.
function isUnsafe(code: number): boolean {
  return (
    (code < 0x20 && code !== 0x09 && code !== 0x0a) ||
    code === 0x7f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function clean(text: string): string {
  let kept = "";
  for (const char of text) {
    if (!isUnsafe(char.charCodeAt(0))) kept += char;
  }
  return kept.trim();
}

/**
 * A question carried in the SAM link (`?ask=`). It only fills the composer:
 * the user reads it and presses send, so a crafted link can never make SAM
 * act. Anything empty or over the limit is dropped, not cut, so what the
 * user sees is always the whole text the link carried.
 */
const samAskSchema = z
  .string()
  .transform(clean)
  .pipe(z.string().min(1).max(SAM_ASK_MAX_LENGTH));

export const samSearchSchema = z.object({
  // Active session id. Omitted until a session is selected/created.
  s: z.string().optional(),
  ask: samAskSchema.optional().catch(undefined),
});

/**
 * Builds the `ask` value for an in-app "Ask SAM" link. Item text (a page URL,
 * a query) can be long, so this cuts it to fit rather than dropping it.
 */
export function samAskText(text: string): string {
  const cleaned = clean(text);
  if (cleaned.length <= SAM_ASK_MAX_LENGTH) return cleaned;
  const cut = cleaned.slice(0, SAM_ASK_MAX_LENGTH - 1);
  // Never leave half of a surrogate pair at the cut.
  const last = cut.charCodeAt(cut.length - 1);
  const whole = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
  return `${whole.trimEnd()}…`;
}
