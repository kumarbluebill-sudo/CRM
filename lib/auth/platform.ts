import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { AppError } from "@/lib/utils/errors";

/**
 * Gate for the platform administration area (plans, every agency's subscription). Only accounts flagged as platform
 * administrators pass, and only with a completed two-step check if they have one. Anyone else gets a plain 404 so the
 * area's existence is not revealed. The database functions behind it repeat the check.
 */
export const requirePlatformAdmin = cache(async () => {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (session.needsMfa) redirect("/login/mfa");
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_super_admin");
  if (data !== true) notFound();
  return { userId: session.userId, email: session.email };
});

/** For server actions: same check, throwing a safe error instead of rendering a page. */
export async function assertPlatformAdmin() {
  const session = await getSessionContext();
  if (!session || session.needsMfa)
    throw new AppError("Please sign in again.", "UNAUTHENTICATED", 401);
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_super_admin");
  if (data !== true) throw new AppError("You do not have permission to do that.", "FORBIDDEN", 403);
  return { userId: session.userId };
}
