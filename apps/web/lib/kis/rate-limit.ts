const KIS_MIN_INTERVAL_MS = 1_000;

let lastRunAt = 0;
let queue = Promise.resolve();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function enqueueKisCall<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const waitMs = Math.max(0, KIS_MIN_INTERVAL_MS - (Date.now() - lastRunAt));
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    try {
      return await task();
    } finally {
      lastRunAt = Date.now();
    }
  });

  queue = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

export async function backoffKisRateLimit(attempt: number) {
  await sleep(1_000 * attempt);
}
