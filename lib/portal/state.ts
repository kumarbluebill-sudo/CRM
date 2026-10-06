export type LinkState = "ACTIVE" | "EXPIRED" | "REVOKED";

export function linkState(
  l: { expires_at: string; revoked_at: string | null },
  now = Date.now(),
): LinkState {
  if (l.revoked_at) return "REVOKED";
  return new Date(l.expires_at).getTime() <= now ? "EXPIRED" : "ACTIVE";
}
