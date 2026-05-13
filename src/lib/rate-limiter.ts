const DEFAULT_LIMIT = 400;
const WINDOW_MS = 60_000;
const CLEANUP_INTERVAL = 120_000;

type BucketEntry = {
  timestamps: number[];
};

const buckets = new Map<string, BucketEntry>();

let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  const cutoff = now - WINDOW_MS;
  for (const [key, entry] of buckets) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetInSeconds: number;
};

export function checkRateLimit(
  key: string,
  limit: number = DEFAULT_LIMIT
): RateLimitResult {
  cleanup();

  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let entry = buckets.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    buckets.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  const remaining = Math.max(0, limit - entry.timestamps.length);
  const oldestInWindow = entry.timestamps[0] ?? now;
  const resetInSeconds = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);

  if (entry.timestamps.length >= limit) {
    return { allowed: false, limit, remaining: 0, resetInSeconds };
  }

  entry.timestamps.push(now);
  return { allowed: true, limit, remaining: remaining - 1, resetInSeconds };
}

export function setRateLimitHeaders(
  headers: Headers,
  result: RateLimitResult
): void {
  headers.set("X-RateLimit-Limit", String(result.limit));
  headers.set("X-RateLimit-Remaining", String(result.remaining));
  headers.set("X-RateLimit-Reset", String(result.resetInSeconds));
  if (!result.allowed) {
    headers.set("Retry-After", String(result.resetInSeconds));
  }
}
