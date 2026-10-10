import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const REAUTH_MINUTES = 15;

/** Only same-site paths are ever used as a return address. */
export function safeNext(value: string | null | undefined, fallback = "/dashboard"): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\r\n]/.test(value)
  )
    return fallback;
  return value.length > 300 ? fallback : value;
}

/** The page a server action was submitted from, read from the Referer header (same-site paths only). */
async function currentPath(): Promise<string> {
  try {
    const referer = (await headers()).get("referer");
    if (!referer) return "/dashboard";
    const u = new URL(referer);
    return safeNext(`${u.pathname}${u.search}`);
  } catch {
    return "/dashboard";
  }
}

/** True when the person signed in (or re-confirmed their password) within the last N minutes. */
export async function isRecentlyAuthenticated(maxMinutes = REAUTH_MINUTES): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.last_sign_in_at) return false;
  return Date.now() - Date.parse(user.last_sign_in_at) <= maxMinutes * 60_000;
}

/**
 * Guard for sensitive actions (tax details, credit notes, roles, exports, authenticator changes). If the sign-in is
 * older than the window, the person is sent to confirm their password and then returned to where they were.
 * Redirects, so it is safe to call at the top of a server action or page; route handlers use isRecentlyAuthenticated.
 */
export async function requireRecentAuth(maxMinutes = REAUTH_MINUTES, next?: string): Promise<void> {
  if (await isRecentlyAuthenticated(maxMinutes)) return;
  redirect(`/reauth?next=${encodeURIComponent(next ? safeNext(next) : await currentPath())}`);
}
