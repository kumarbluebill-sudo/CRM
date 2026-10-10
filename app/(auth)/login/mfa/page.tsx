import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { logoutAction, verifyMfaAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { safeNext } from "@/lib/auth/recent";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.nextLevel !== "aal2" || aal.currentLevel === "aal2") redirect(next);

  return (
    <>
      <h1 className="text-xl font-semibold">Two-step verification</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        Open your authenticator app and enter the 6-digit code for this account.
      </p>
      <AuthForm
        action={verifyMfaAction.bind(null, next)}
        submitLabel="Verify and continue"
        fields={[
          {
            name: "code",
            label: "6-digit code",
            type: "text",
            autoComplete: "one-time-code",
            placeholder: "123456",
          },
        ]}
      />
      <form action={logoutAction} className="mt-4">
        <Button type="submit" variant="ghost" size="sm">
          Sign out and use a different account
        </Button>
      </form>
    </>
  );
}
