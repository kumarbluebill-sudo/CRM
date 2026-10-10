import { getPublicEnv } from "@/lib/env";

/**
 * Cross-site request check for plain route handlers (server actions get this from Next.js itself). A request that
 * carries an Origin header must come from this app's own address; requests with no Origin (non-browser callers) pass
 * here and are still subject to authentication.
 */
export function sameOrigin(request: Request, ownOrigin?: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const given = new URL(origin).host;
    if (ownOrigin && given === new URL(ownOrigin).host) return true;
    const configured = getPublicEnv().NEXT_PUBLIC_APP_URL;
    if (configured && given === new URL(configured).host) return true;
    const host = request.headers.get("host");
    return Boolean(host) && given === host;
  } catch {
    return false;
  }
}
