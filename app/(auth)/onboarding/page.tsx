import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { acceptInviteAction, createOrganizationAction } from "@/app/(auth)/actions";
import { label } from "@/lib/crm/constants";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Set up your agency" };

export default async function OnboardingPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (session.organization) redirect("/dashboard");

  const supabase = await createClient();
  const { data: invites } = await supabase.rpc("my_invite");
  const invite = (invites as { org_name: string; role: string }[] | null)?.[0];

  if (invite) {
    return (
      <>
        <h1 className="text-xl font-semibold">Join {invite.org_name}</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          You&apos;ve been invited as <strong>{label(invite.role)}</strong>.
        </p>
        <AuthForm action={acceptInviteAction} submitLabel="Accept invitation" fields={[]} />
        <p className="text-muted-foreground mt-6 text-xs">
          Not for you? Sign out and use a different account, or create your own agency by asking the
          person who invited you to revoke it.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Set up your agency</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        You&apos;ll be the owner. You can add branding and teammates later.
      </p>
      <AuthForm
        action={createOrganizationAction}
        submitLabel="Create agency"
        fields={[{ name: "name", label: "Agency name", autoComplete: "organization" }]}
      />
    </>
  );
}
