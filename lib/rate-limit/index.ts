/**
 * Fixed-window rate limiter.
 *
 * With UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN set, counts live in Redis and are shared by every serverless
 * instance (this is what makes limits real on Vercel). Without them, or if Redis is unreachable, it falls back to a
 * per-instance in-memory counter: weaker, but never fails open completely and never takes the app down.
 */
type Entry = { count: number; resetAt: number };
const buckets = new Map<string, Entry>();

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

function memoryLimit(key: string, limit: number, windowMs: number, now: number): RateLimitResult {
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
  };
}

async function redisLimit(
  url: string,
  token: string,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  // INCR then set the expiry only on the first hit (NX), in one round trip; PTTL tells us when the window ends.
  const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify([
      ["INCR", key],
      ["PEXPIRE", key, String(windowMs), "NX"],
      ["PTTL", key],
    ]),
    signal: AbortSignal.timeout(1500),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const out = (await res.json()) as { result?: number }[];
  const count = Number(out[0]?.result);
  const ttl = Number(out[2]?.result);
  if (!Number.isFinite(count)) throw new Error("upstash bad response");
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds:
      count <= limit ? 0 : Math.max(1, Math.ceil((ttl > 0 ? ttl : windowMs) / 1000)),
  };
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<RateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) {
    try {
      return await redisLimit(url, token, `rl:${key}`, limit, windowMs);
    } catch {
      // Redis hiccup: degrade to the in-memory limiter rather than blocking or ignoring limits entirely.
    }
  }
  return memoryLimit(key, limit, windowMs, now);
}

export function resetRateLimits() {
  buckets.clear();
}
