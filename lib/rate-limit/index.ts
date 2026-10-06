/**
 * Fixed-window rate limiter behind a small interface.
 *
 * This in-memory implementation is per server instance, so on Vercel it only
 * softens bursts. It is replaced by an Upstash Redis implementation (same
 * signature) once UPSTASH_REDIS_REST_URL/TOKEN are configured.
 */
type Entry = { count: number; resetAt: number };
const buckets = new Map<string, Entry>();

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    retryAfterSeconds,
  };
}

export function resetRateLimits() {
  buckets.clear();
}
