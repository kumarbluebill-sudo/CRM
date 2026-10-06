/**
 * Minimal Sentry reporter (no SDK): posts one event to the Sentry envelope endpoint. Server-side only, fire and
 * forget, never throws, capped at 30 events a minute per instance so an error storm can't flood the quota.
 *
 * Only the log message and the already-redacted logger context are sent. No request bodies, headers, cookies or
 * user objects are attached, so nothing identifying leaves the platform unless a developer logs it.
 */
let windowStart = 0;
let sent = 0;

export function parseDsn(dsn: string): { endpoint: string; key: string } | null {
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\//, "");
    if (u.protocol !== "https:" || !u.username || !/^\d+$/.test(project)) return null;
    return { endpoint: `https://${u.host}/api/${project}/envelope/`, key: u.username };
  } catch {
    return null;
  }
}

export function reportToSentry(
  level: "warning" | "error",
  message: string,
  context: unknown,
  now = Date.now(),
): void {
  if (typeof window !== "undefined") return;
  const dsn = process.env.SENTRY_DSN?.trim();
  const target = dsn ? parseDsn(dsn) : null;
  if (!target) return;
  if (now - windowStart > 60_000) {
    windowStart = now;
    sent = 0;
  }
  if (++sent > 30) return;

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: now / 1000,
    level,
    platform: "node",
    logger: "app",
    message: message.slice(0, 500),
    environment: process.env.APP_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12),
    extra: context ?? {},
  };
  const body = [
    JSON.stringify({ event_id: eventId, sent_at: new Date(now).toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
  void fetch(target.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-sentry-envelope",
      "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${target.key}, sentry_client=smart-travel-crm/1`,
    },
    body,
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
}
