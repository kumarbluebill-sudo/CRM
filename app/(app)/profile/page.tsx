import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { updateProfileAction } from "@/app/(auth)/actions";
import { requireOrgSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EntityForm } from "@/components/forms/entity-form";
import { saveDisplayPrefsAction } from "@/app/(app)/profile/actions";
import {
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  WEEK_START_OPTIONS,
  timeZoneOptions,
} from "@/lib/datetime/zones";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const session = await requireOrgSession();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, timezone, date_format, time_format, week_start")
    .eq("id", session.userId)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
      <p className="text-muted-foreground mt-1 mb-6 text-sm">
        {session.email} · {session.role?.replace("_", " ").toLowerCase()} at{" "}
        {session.organization.name}
      </p>
      <p className="mb-4 text-sm">
        <a href="/profile/security" className="text-primary underline">
          Two-step verification and devices
        </a>
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
      <div className="bg-card mt-5 rounded-xl border p-6">
        <h2 className="text-sm font-semibold">Date and time display</h2>
        <p className="text-muted-foreground mt-1 mb-4 text-xs">
          Changes how times appear for you only; the underlying times never change. Leave a setting
          on the first option to follow your agency or branch.
        </p>
        <EntityForm
          action={saveDisplayPrefsAction}
          submitLabel="Save display settings"
          fields={[
            {
              name: "timezone",
              label: "My time zone",
              type: "select",
              wide: true,
              options: [{ value: "", label: "Follow agency / branch" }, ...timeZoneOptions()],
              defaultValue: profile?.timezone ?? "",
            },
            {
              name: "dateFormat",
              label: "Date format",
              type: "select",
              options: [{ value: "", label: "Follow agency" }, ...DATE_FORMAT_OPTIONS],
              defaultValue: profile?.date_format ?? "",
            },
            {
              name: "timeFormat",
              label: "Time format",
              type: "select",
              options: [{ value: "", label: "Follow agency" }, ...TIME_FORMAT_OPTIONS],
              defaultValue: profile?.time_format ?? "",
            },
            {
              name: "weekStart",
              label: "First day of the week",
              type: "select",
              options: [{ value: "", label: "Follow agency" }, ...WEEK_START_OPTIONS],
              defaultValue:
                profile?.week_start === null || profile?.week_start === undefined
                  ? ""
                  : String(profile.week_start),
            },
          ]}
        />
      </div>
    </div>
  );
}
