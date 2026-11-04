/**
 * One JSON line per event. Callers pass counters and fixed codes only: prompts,
 * replies, tokens and CLI output never reach this function.
 */
export function log(event, fields = {}) {
  console.log(
    JSON.stringify({ at: new Date().toISOString(), event, ...fields }),
  );
}
