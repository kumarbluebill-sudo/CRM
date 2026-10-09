import type { Metadata } from "next";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { DESIGNATIONS } from "@/lib/jobs/constants";
import { getStaffDirectory } from "@/lib/jobs/queries";
import { createClient } from "@/lib/supabase/server";
import { saveStaffAction } from "@/app/(app)/settings/staff/actions";

export const metadata: Metadata = { title: "Staff details" };

export default async function StaffPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("users.manage")) {
    return (
      <EmptyState
        icon={Users}
        title="No access"
        description="Only owners and admins can manage staff details."
      />
    );
  }
  const supabase = await createClient();
  const [directory, { data: phones }] = await Promise.all([
    getStaffDirectory(),
    supabase.from("staff_profiles").select("user_id, phone"),
  ]);
  const phone = new Map((phones ?? []).map((p) => [p.user_id as string, p.phone as string | null]));
  const managers = directory.map((s) => ({ value: s.user_id, label: s.name }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Staff details"
        description="Employee code, designation, department and reporting manager. These are used when assigning job orders. Roles and invitations are under Team."
      />
      <p className="text-muted-foreground text-xs">
        Suggested designations: {DESIGNATIONS.join(", ")}. You can type any title. Marking someone
        inactive stops new jobs being assigned to them; their login and role are unchanged.
      </p>
      <Card>
        <CardContent>
          <ul className="divide-y text-sm">
            {directory.map((s) => (
              <li key={s.user_id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-40 font-medium">{s.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {label(s.role)}
                    {s.employee_code ? ` · ${s.employee_code}` : ""}
                    {s.designation ? ` · ${s.designation}` : ""}
                    {s.department ? ` · ${s.department}` : ""}
                  </span>
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {s.open_jobs ?? 0} open · {s.overdue_jobs ?? 0} overdue
                    </span>
                    {!s.active && <StatusBadge value="CANCELLED" />}
                  </span>
                </div>
                <details className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    Edit details for {s.name}
                  </summary>
                  <div className="pt-3">
                    <EntityForm
                      action={saveStaffAction.bind(null, s.user_id)}
                      submitLabel="Save details"
                      fields={[
                        {
                          name: "employeeCode",
                          label: "Employee code",
                          defaultValue: s.employee_code,
                        },
                        {
                          name: "designation",
                          label: "Designation",
                          defaultValue: s.designation,
                          placeholder: "e.g. Visa Processing Officer",
                        },
                        {
                          name: "department",
                          label: "Department",
                          defaultValue: s.department,
                          placeholder: "e.g. Visa desk",
                        },
                        {
                          name: "phone",
                          label: "Phone",
                          type: "tel",
                          defaultValue: phone.get(s.user_id),
                        },
                        {
                          name: "reportingManagerId",
                          label: "Reports to",
                          type: "select",
                          options: managers.filter((m) => m.value !== s.user_id),
                          defaultValue: s.reporting_manager_id,
                        },
                        {
                          name: "active",
                          label: "Active (can be assigned jobs)",
                          type: "checkbox",
                          defaultValue: s.active,
                        },
                      ]}
                    />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
