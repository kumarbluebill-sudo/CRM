import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { reauthAction } from "@/app/(auth)/actions";
import { safeNext } from "@/lib/auth/recent";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Confirm your password" };

export default async function ReauthPage({
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
  return (
    <>
      <h1 className="text-xl font-semibold">Confirm it&apos;s you</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        For your security, please enter your password again to continue. You&apos;re signed in as{" "}
        <strong>{user.email}</strong>.
      </p>
      <AuthForm
        action={reauthAction.bind(null, next)}
        submitLabel="Confirm and continue"
        fields={[
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "current-password",
          },
        ]}
      />
    </>
  );
}
