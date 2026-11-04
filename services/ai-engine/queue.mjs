class QueueError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** Runs one job at a time. Waiting jobs are limited in number and in time. */
export function createQueue({ limit, waitMs }) {
  const waiting = [];
  let running = false;

  const next = () => {
    if (running) return;
    const item = waiting.shift();
    if (!item) return;
    clearTimeout(item.timer);
    item.signal?.removeEventListener("abort", item.onAbort);
    running = true;
    item
      .job()
      .then(item.resolve, item.reject)
      .finally(() => {
        running = false;
        next();
      });
  };

  return {
    stats: () => ({ running: running ? 1 : 0, waiting: waiting.length }),
    run(job, signal) {
      if (signal?.aborted) return Promise.reject(new QueueError("aborted"));
      if (waiting.length >= limit)
        return Promise.reject(new QueueError("queue_full"));
      return new Promise((resolve, reject) => {
        const leave = (code) => {
          const index = waiting.indexOf(item);
          if (index === -1) return;
          waiting.splice(index, 1);
          clearTimeout(item.timer);
          signal?.removeEventListener("abort", item.onAbort);
          reject(new QueueError(code));
        };
        const item = {
          job,
          signal,
          resolve,
          reject,
          onAbort: () => leave("aborted"),
          timer: setTimeout(() => leave("queue_timeout"), waitMs),
        };
        signal?.addEventListener("abort", item.onAbort, { once: true });
        waiting.push(item);
        next();
      });
    },
  };
}
