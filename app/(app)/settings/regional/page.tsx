import type { Metadata } from "next";
import { Globe } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { getDisplayPrefs } from "@/lib/datetime/prefs";
import {
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  WEEK_START_OPTIONS,
  timeZoneOptions,
} from "@/lib/datetime/zones";
import { createClient } from "@/lib/supabase/server";
import { saveBranchAction, saveRegionalAction } from "@/app/(app)/settings/regional/actions";

export const metadata: Metadata = { title: "Regional settings" };

export default async function RegionalPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("settings.manage")) {
    return (
      <EmptyState
        icon={Globe}
        title="No access"
        description="Only owners and admins can change regional settings."
      />
    );
  }
  const supabase = await createClient();
  const [{ data: org }, { data: branches }, prefs] = await Promise.all([
    supabase
      .from("organization_settings")
      .select("timezone, date_format, time_format, week_start")
      .maybeSingle(),
    supabase.from("branches").select("id, name, code, timezone, active").order("name"),
    getDisplayPrefs(),
  ]);
  const zones = timeZoneOptions();
  const defaultZone = org?.timezone ?? "Asia/Kolkata";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Regional settings"
        description="Time zone and date formats for your agency. Each person can override these on their own profile, and branches can have their own zone."
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Regional" }]}
      />
      <Card>
        <CardHeader>
          <CardTitle>Agency defaults</CardTitle>
          <p className="text-muted-foreground text-xs">
            Times are stored once (in UTC) and shown in the zone below, so changing it never moves a
            booking or reminder. You are currently seeing times in <strong>{prefs.timeZone}</strong>
            .
          </p>
        </CardHeader>
        <CardContent>
          <EntityForm
            action={saveRegionalAction}
            submitLabel="Save"
            fields={[
              {
                name: "timezone",
                label: "Default time zone",
                type: "select",
                required: true,
                wide: true,
                options: zones,
                defaultValue: defaultZone,
              },
              {
                name: "dateFormat",
                label: "Date format",
                type: "select",
                required: true,
                options: DATE_FORMAT_OPTIONS,
                defaultValue: org?.date_format ?? "DD/MM/YYYY",
              },
              {
                name: "timeFormat",
                label: "Time format",
                type: "select",
                required: true,
                options: TIME_FORMAT_OPTIONS,
                defaultValue: org?.time_format ?? "12h",
              },
              {
                name: "weekStart",
                label: "First day of the week",
                type: "select",
                required: true,
                options: WEEK_START_OPTIONS,
                defaultValue: String(org?.week_start ?? 1),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
          <p className="text-muted-foreground text-xs">
            People in a branch see its time zone unless they chose their own. Put people into
            branches under Roles and access.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(branches ?? []).map((b) => (
            <details key={b.id} className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {b.name}
                {b.code ? ` (${b.code})` : ""} · {b.timezone}
                {b.active ? "" : " · inactive"}
              </summary>
              <div className="pt-3">
                <EntityForm
                  action={saveBranchAction.bind(null, b.id)}
                  submitLabel="Save branch"
                  fields={[
                    { name: "name", label: "Name", required: true, defaultValue: b.name },
                    { name: "code", label: "Code", defaultValue: b.code },
                    {
                      name: "timezone",
                      label: "Time zone",
                      type: "select",
                      required: true,
                      options: zones,
                      defaultValue: b.timezone,
                    },
                    { name: "active", label: "Active", type: "checkbox", defaultValue: b.active },
                  ]}
                />
              </div>
            </details>
          ))}
          <details
            className="rounded-lg border border-dashed p-3"
            open={(branches ?? []).length === 0}
          >
            <summary className="cursor-pointer text-sm font-medium">Add a branch</summary>
            <div className="pt-3">
              <EntityForm
                action={saveBranchAction.bind(null, null)}
                submitLabel="Add branch"
                fields={[
                  { name: "name", label: "Name", required: true },
                  { name: "code", label: "Code" },
                  {
                    name: "timezone",
                    label: "Time zone",
                    type: "select",
                    required: true,
                    options: zones,
                    defaultValue: defaultZone,
                  },
                  { name: "active", label: "Active", type: "checkbox", defaultValue: true },
                ]}
              />
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
