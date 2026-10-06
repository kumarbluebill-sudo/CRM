import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";

/**
 * Service-role client. It bypasses RLS, so it is used ONLY for private storage objects, and only after the
 * caller has been authorised through RLS-protected tables. Never import this from client code or use it for
 * ordinary data access.
 */
export function createAdminClient() {
  const url = getPublicEnv().NEXT_PUBLIC_SUPABASE_URL;
  const key = getServerEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
