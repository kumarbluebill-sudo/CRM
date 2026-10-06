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
    const { data: rows } = await supabase
      .from("role_permissions")
      .select("permission_key")
      .eq("role_key", member.role);
    permissions = new Set((rows ?? []).map((r) => r.permission_key));
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
  if (!session.organization) redirect("/onboarding");
  return session as SessionContext & { organization: NonNullable<SessionContext["organization"]> };
}

/** For server actions / route handlers: throws AppError instead of redirecting. */
export async function requirePermission(permission: Permission) {
  const session = await getSessionContext();
  if (!session) throw new AppError("Please sign in.", "UNAUTHENTICATED", 401);
  if (!session.organization || !session.permissions.has(permission)) {
    throw new AppError("You don't have permission to do that.", "FORBIDDEN", 403);
  }
  return session;
}
