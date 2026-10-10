import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { RoleEditor, StaffAccessTable, type RoleRow } from "@/components/settings/roles-ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Roles and access" };

export default async function RolesPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("users.manage")) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No access"
        description="Only owners and admins can manage roles and access."
      />
    );
  }
  const supabase = await createClient();
  const [roles, perms, members, branches, systemRoles, staffProfiles] = await Promise.all([
    supabase.from("org_roles").select("id, name, description, base_role, data_scope").order("name"),
    supabase.from("org_role_permissions").select("org_role_id, permission_key"),
    supabase.from("organization_members").select("user_id, role, org_role_id, branch_id"),
    supabase.from("branches").select("id, name").eq("active", true).order("name"),
    supabase
      .from("roles")
      .select("key, label, rank")
      .neq("key", "SUPER_ADMIN")
      .order("rank", { ascending: false }),
    supabase.from("staff_profiles").select("user_id, max_active_assignments"),
  ]);
  const ids = (members.data ?? []).map((m) => m.user_id as string);
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] };
  const person = new Map((people ?? []).map((p) => [p.id as string, p]));
  const rank = new Map((systemRoles.data ?? []).map((r) => [r.key as string, r.rank as number]));
  const myRank = rank.get(session.role ?? "") ?? 0;
  const limit = new Map(
    (staffProfiles.data ?? []).map((s) => [
      s.user_id as string,
      s.max_active_assignments as number | null,
    ]),
  );

  const bases = (systemRoles.data ?? [])
    .filter((r) => (r.rank as number) < myRank && r.key !== "OWNER")
    .map((r) => ({ value: r.key as string, label: r.label as string }));
  // only permissions the signed-in person holds themselves can be offered
  const grantable = PERMISSIONS.filter((p) => session.permissions.has(p));

  const rows: RoleRow[] = (roles.data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    base_role: r.base_role as string,
    data_scope: r.data_scope as string,
    permissions: (perms.data ?? [])
      .filter((p) => p.org_role_id === r.id)
      .map((p) => p.permission_key as string),
    members: (members.data ?? []).filter((m) => m.org_role_id === r.id).length,
  }));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title="Roles and access"
        description="Create roles with exactly the permissions you want, choose which records each role can see, and put people into branches."
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Roles and access" }]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Staff</CardTitle>
          <p className="text-muted-foreground text-xs">
            &ldquo;Standard role&rdquo; means the role set on the Team page. Changes here are
            recorded in the audit log. Sensitive changes ask you to confirm your password again.
          </p>
        </CardHeader>
        <CardContent>
          <StaffAccessTable
            roles={rows.map((r) => ({ id: r.id, name: r.name }))}
            branches={(branches.data ?? []).map((b) => ({
              id: b.id as string,
              name: b.name as string,
            }))}
            staff={(members.data ?? []).map((m) => {
              const p = person.get(m.user_id as string);
              return {
                userId: m.user_id as string,
                name: (p?.full_name as string) ?? "",
                email: (p?.email as string) ?? "",
                systemRole: m.role as string,
                orgRoleId: (m.org_role_id as string | null) ?? null,
                branchId: (m.branch_id as string | null) ?? null,
                maxJobs: limit.get(m.user_id as string) ?? null,
                canManage: (rank.get(m.role as string) ?? 100) < myRank,
                isSelf: m.user_id === session.userId,
              };
            })}
          />
        </CardContent>
      </Card>

      {rows.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <CardTitle>
              {r.name}{" "}
              <span className="text-muted-foreground text-xs font-normal">
                · {r.members} people
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RoleEditor role={r} bases={bases} grantable={grantable} />
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>New role</CardTitle>
        </CardHeader>
        <CardContent>
          <RoleEditor bases={bases} grantable={grantable} />
        </CardContent>
      </Card>
    </div>
  );
}
