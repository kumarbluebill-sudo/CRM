import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { label, options } from "@/lib/crm/constants";
import { uuid } from "@/lib/crm/schemas";
import { JOB_PRIORITIES, RELATED_TYPES } from "@/lib/jobs/constants";
import { getStaffDirectory } from "@/lib/jobs/queries";
import { listCustomerOptionsWithId } from "@/lib/quotation/queries";
import { createJobAction } from "@/app/(app)/jobs/actions";

export const metadata: Metadata = { title: "New job order" };

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{
    relatedType?: string;
    relatedId?: string;
    customerId?: string;
    assignee?: string;
  }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("jobs.create")) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No access"
        description="You don't have permission to create job orders."
      />
    );
  }
  const sp = await searchParams;
  const [directory, customers] = await Promise.all([
    getStaffDirectory(),
    listCustomerOptionsWithId(),
  ]);
  const canAssign = session.permissions.has("jobs.assign");
  const staff = directory
    .filter((s) => s.active && (canAssign || s.user_id === session.userId))
    .map((s) => ({
      value: s.user_id,
      label: `${s.name}${s.designation ? ` · ${s.designation}` : ""}${s.department ? ` · ${s.department}` : ""}${s.open_jobs != null ? ` (${s.open_jobs} open)` : ""}`,
    }));
  const related =
    RELATED_TYPES.some((r) => r.value === sp.relatedType) &&
    sp.relatedId &&
    uuid.safeParse(sp.relatedId).success
      ? { type: sp.relatedType!, id: sp.relatedId }
      : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="New job order"
        description={
          canAssign ? "Describe the work and choose who does it." : "Create a job for yourself."
        }
      />
      <Card>
        <CardContent>
          {related && (
            <p className="text-muted-foreground pb-3 text-sm">
              Linked to: <strong>{label(related.type)}</strong> record.
            </p>
          )}
          <EntityForm
            action={createJobAction}
            submitLabel="Create job order"
            hidden={related ? { relatedType: related.type, relatedId: related.id } : undefined}
            fields={[
              {
                name: "title",
                label: "Job title",
                required: true,
                wide: true,
                placeholder: "e.g. Collect passport copies for Bali group",
              },
              { name: "instructions", label: "Instructions", type: "textarea", wide: true },
              {
                name: "assignedTo",
                label: "Assign to",
                type: "select",
                options: staff,
                defaultValue:
                  sp.assignee && uuid.safeParse(sp.assignee).success
                    ? sp.assignee
                    : canAssign
                      ? undefined
                      : session.userId,
                placeholder: "Search by name…",
              },
              { name: "assignedTeam", label: "Team (optional)", placeholder: "e.g. Visa desk" },
              {
                name: "priority",
                label: "Priority",
                type: "select",
                required: true,
                options: options(JOB_PRIORITIES),
                defaultValue: "NORMAL",
              },
              { name: "startDate", label: "Start date", type: "date" },
              { name: "deadline", label: "Deadline", type: "date" },
              {
                name: "customerId",
                label: "Customer (optional)",
                type: "select",
                options: customers,
                defaultValue:
                  sp.customerId && uuid.safeParse(sp.customerId).success
                    ? sp.customerId
                    : undefined,
                wide: true,
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
