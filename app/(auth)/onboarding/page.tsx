import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { createOrganizationAction } from "@/app/(auth)/actions";
import { getSessionContext } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Set up your agency" };

export default async function OnboardingPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (session.organization) redirect("/dashboard");

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
