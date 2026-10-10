import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { AppError } from "@/lib/utils/errors";
import type { Permission, Role } from "@/lib/permissions";

export type SessionContext = {
  userId: string;
  email: string;
  fullName: string;
  organization: { id: string; name: string; status: string } | null;
  role: Role | null;
  permissions: ReadonlySet<string>;
  /** Password was accepted but the second step has not been completed: nothing else may be shown. */
  needsMfa?: boolean;
};

/**
 * Resolves the caller from the verified Supabase session (server-side only).
 * Identity, organization and permissions are never read from client input.
 * Returns null when signed out. Reads go through RLS.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser(); // validates the JWT with Supabase Auth
  if (!user) return null;

  // A person with an authenticator must complete the second step before anything else works. The database enforces
  // the same rule (see mfa_satisfied()), so this is a friendlier route into it, not the only barrier.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    return {
      userId: user.id,
      email: user.email ?? "",
      fullName: "",
      organization: null,
      role: null,
      permissions: new Set<string>(),
      needsMfa: true,
    };
  }

  const [{ data: profile }, { data: member }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("organization_members")
      .select("role, organizations ( id, name, status )")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  let permissions = new Set<string>();
  if (member) {
    // the database resolves custom roles and system roles alike (and returns nothing for deactivated staff)
    const { data: keys } = await supabase.rpc("my_permissions");
    permissions = new Set(((keys ?? []) as unknown as string[]).map(String));
  }

  const org = Array.isArray(member?.organizations)
    ? member?.organizations[0]
    : member?.organizations;
  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? "",
    organization: org ? { id: org.id, name: org.name, status: org.status } : null,
    role: (member?.role as Role | undefined) ?? null,
    permissions,
  };
});

/** For pages/layouts: redirects to login if signed out, onboarding if no organization. */
export async function requireOrgSession(): Promise<
  SessionContext & { organization: NonNullable<SessionContext["organization"]> }
> {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (session.needsMfa) redirect("/login/mfa");
  if (!session.organization) redirect("/onboarding");
  return session as SessionContext & { organization: NonNullable<SessionContext["organization"]> };
}

const lastDenied = new Map<string, number>();

/** Records a refused action in the security log (best effort, at most once a minute per person and permission). */
async function noteDenied(permission: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const key = `${user.id}:${permission}`;
    const now = Date.now();
    if (now - (lastDenied.get(key) ?? 0) < 60_000) return;
    lastDenied.set(key, now);
    if (lastDenied.size > 5000) lastDenied.clear();
    await supabase.rpc("log_my_security_event", {
      p_kind: "PERMISSION_DENIED",
      p_detail: permission.slice(0, 80),
    });
  } catch {
    /* logging must never get in the way */
  }
}

/** For server actions / route handlers: throws AppError instead of redirecting. */
export async function requirePermission(permission: Permission) {
  const session = await getSessionContext();
  if (!session) throw new AppError("Please sign in.", "UNAUTHENTICATED", 401);
  if (session.needsMfa)
    throw new AppError("Please complete two-step verification first.", "MFA_REQUIRED", 401);
  if (!session.organization || !session.permissions.has(permission)) {
    await noteDenied(permission);
    throw new AppError("You don't have permission to do that.", "FORBIDDEN", 403);
  }
  return session;
}
