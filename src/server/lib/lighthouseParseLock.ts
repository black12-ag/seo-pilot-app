// One payload read+parse at a time per isolate. This runs in the open-seo-audit
// worker, and the raw Lighthouse payload (1-10MB, held several times over while
// parsing) is the operation that OOMed the main worker; concurrent checks
// bursting onto one isolate could do the same here. The provider fetches
// themselves stay concurrent — parsing (well under a second each) is cheap
// against a 30-60s fetch, and workerd streams un-read response bodies, so queued
// siblings don't buffer.
let parseChain: Promise<unknown> = Promise.resolve();

export function withLighthouseParseLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = parseChain.then(fn, fn);
  parseChain = run.catch(() => {});
  return run;
}
