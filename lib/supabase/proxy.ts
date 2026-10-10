import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv, isSupabaseConfigured } from "@/lib/env";

/** A signed-in person who does nothing for this long is signed out (default 8 hours; override with SESSION_IDLE_MINUTES). */
export const IDLE_MINUTES = Math.min(
  Math.max(Number(process.env.SESSION_IDLE_MINUTES) || 480, 5),
  24 * 60,
);
export const SEEN_COOKIE = "crm_last_seen";
const TOUCH_EVERY_MS = 60_000;

/**
 * Refreshes the Supabase session cookie on each request, ends sessions that have been idle too long, and tells the
 * page which path it is serving (used to show the "set up two-step verification" screen only where appropriate).
 * No-op when Supabase is not configured so the app still runs locally. This is NOT an authorization check; routes,
 * server actions and row security enforce access.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const headers = new Headers(request.headers);
  headers.set("x-crm-path", request.nextUrl.pathname);
  let response = NextResponse.next({ request: { headers } });
  const env = getPublicEnv();
  if (!isSupabaseConfigured(env)) return response;

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Validates the token with Supabase Auth and refreshes it if needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    if (request.cookies.has(SEEN_COOKIE)) response.cookies.delete(SEEN_COOKIE);
    return response;
  }

  const now = Date.now();
  const seen = Number(request.cookies.get(SEEN_COOKIE)?.value ?? 0);
  if (seen && now - seen > IDLE_MINUTES * 60_000) {
    await supabase.auth.signOut(); // clears the session cookies through setAll above
    const path = request.nextUrl.pathname;
    const out = path.startsWith("/api/")
      ? NextResponse.json(
          { error: "Your session timed out. Please sign in again." },
          { status: 401 },
        )
      : NextResponse.redirect(new URL("/login?reason=timeout", request.url));
    for (const c of response.cookies.getAll()) out.cookies.set(c);
    out.cookies.delete(SEEN_COOKIE);
    return out;
  }
  // Background polling (the notification bell) must not keep an idle session alive.
  if (
    !request.nextUrl.pathname.startsWith("/api/notifications/") &&
    (!seen || now - seen > TOUCH_EVERY_MS)
  ) {
    response.cookies.set(SEEN_COOKIE, String(now), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return response;
}
