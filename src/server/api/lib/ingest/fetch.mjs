const USER_AGENT =
  "ComplyContentBot/1.0 (+https://comply.app; compliance content ingestion; contact: ops@comply.app)";

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export async function fetchText(url, { retries = 2, timeoutMs = 30_000 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          "accept-language": "en",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) {
        return await response.text();
      }

      lastError = new Error(`HTTP ${response.status} for ${url}`);
      if (!RETRY_STATUSES.has(response.status)) break;
    } catch (error) {
      lastError = error;
    }

    await sleep(250 * (attempt + 1));
  }

  throw lastError ?? new Error(`Could not fetch ${url}`);
}

/** Runs tasks with a fixed concurrency ceiling, keeping result order. */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
