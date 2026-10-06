import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { updateProfileAction } from "@/app/(auth)/actions";
import { requireOrgSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const session = await requireOrgSession();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", session.userId)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
      <p className="text-muted-foreground mt-1 mb-6 text-sm">
        {session.email} · {session.role?.replace("_", " ").toLowerCase()} at{" "}
        {session.organization.name}
      </p>
      <div className="bg-card rounded-xl border p-6">
        <AuthForm
          action={updateProfileAction}
          submitLabel="Save"
          fields={[
            { name: "fullName", label: "Full name", defaultValue: profile?.full_name ?? "" },
            {
              name: "phone",
              label: "Phone",
              type: "tel",
              optional: true,
              defaultValue: profile?.phone ?? "",
            },
          ]}
        />
      </div>
    </div>
  );
}
