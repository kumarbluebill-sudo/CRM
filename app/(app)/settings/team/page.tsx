import type { Metadata } from "next";
import { Users } from "lucide-react";
import { EntityForm } from "@/components/forms/entity-form";
import { PageHeader } from "@/components/crm/page-header";
import {
  RemoveMemberButton,
  RevokeInviteButton,
  RoleSelect,
} from "@/components/settings/team-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { getOrgLimits } from "@/lib/billing/queries";
import { createClient } from "@/lib/supabase/server";
import { inviteMemberAction } from "@/app/(app)/settings/team/actions";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("users.manage")) {
    return (
      <EmptyState
        icon={Users}
        title="No access"
        description="Only owners and admins can manage the team."
      />
    );
  }
  const supabase = await createClient();
  const [members, invites, roles, plan] = await Promise.all([
    supabase.from("organization_members").select("user_id, role, created_at").order("created_at"),
    supabase
      .from("organization_invites")
      .select("id, email, role, expires_at")
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
    supabase
      .from("roles")
      .select("key, label, rank")
      .neq("key", "SUPER_ADMIN")
      .order("rank", { ascending: false }),
    getOrgLimits(),
  ]);
  const ids = (members.data ?? []).map((m) => m.user_id as string);
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] };
  const person = new Map((people ?? []).map((p) => [p.id as string, p]));

  const myRank =
    ((roles.data ?? []).find((r) => r.key === session.role)?.rank as number | undefined) ?? 0;
  const rankOf = new Map((roles.data ?? []).map((r) => [r.key as string, r.rank as number]));
  // Roles this user may hand out: strictly below their own, and never OWNER.
  const assignable = (roles.data ?? [])
    .filter((r) => (r.rank as number) < myRank && r.key !== "OWNER")
    .map((r) => ({ value: r.key as string, label: r.label as string }));
  const seats = plan?.limits.seats ?? 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Team"
        description={`${(members.data ?? []).length} of ${seats} seats used${
          (invites.data ?? []).length ? `, ${(invites.data ?? []).length} invited` : ""
        }`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {(members.data ?? []).map((m) => {
              const p = person.get(m.user_id as string);
              const name = (p?.full_name as string) || (p?.email as string) || "Member";
              const isMe = m.user_id === session.userId;
              const canManage = !isMe && (rankOf.get(m.role as string) ?? 99) < myRank;
              return (
                <li key={m.user_id as string} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {name}{" "}
                      {isMe && <span className="text-muted-foreground font-normal">(you)</span>}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">{p?.email as string}</p>
                  </div>
                  {canManage ? (
                    <>
                      <RoleSelect
                        userId={m.user_id as string}
                        current={m.role as string}
                        options={assignable}
                      />
                      <RemoveMemberButton userId={m.user_id as string} name={name} />
                    </>
                  ) : (
                    <span className="text-muted-foreground">{label(m.role as string)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {(invites.data ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {(invites.data ?? []).map((i) => (
                <li key={i.id as string} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate">{i.email as string}</span>
                  <span className="text-muted-foreground">{label(i.role as string)}</span>
                  <span className="text-muted-foreground text-xs">
                    expires {String(i.expires_at).slice(0, 10)}
                  </span>
                  <RevokeInviteButton id={i.id as string} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite someone</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            They sign up or sign in with this exact email address and are added with the role you
            pick.
          </p>
          <EntityForm
            action={inviteMemberAction}
            submitLabel="Send invitation"
            fields={[
              { name: "email", label: "Email", type: "email", required: true },
              {
                name: "role",
                label: "Role",
                type: "select",
                required: true,
                options: assignable,
                defaultValue: assignable.at(-1)?.value,
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
