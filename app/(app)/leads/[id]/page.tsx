import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EntityForm } from "@/components/forms/entity-form";
import { ConfirmActionButton } from "@/components/crm/confirm-action-button";
import { leadFields } from "@/components/crm/lead-fields";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { TaskCompleteButton } from "@/components/crm/task-complete-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import {
  getLead,
  listCustomerOptions,
  listLeadSourceOptions,
  listLeadTimeline,
  listTasks,
  listTeamMembers,
} from "@/lib/crm/queries";
import { uuid } from "@/lib/crm/schemas";
import { addLeadNoteAction, deleteLeadAction, updateLeadAction } from "@/app/(app)/leads/actions";
import { createTaskAction } from "@/app/(app)/tasks/actions";
import { taskFields } from "@/components/crm/task-fields";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  const lead = await getLead(id); // RLS: null if missing OR belongs to another organization
  if (!lead) notFound();

  const [customers, sources, team, timeline, tasks] = await Promise.all([
    listCustomerOptions(),
    listLeadSourceOptions(),
    listTeamMembers(),
    listLeadTimeline(id),
    listTasks({ scope: "open", relatedId: id }),
  ]);
  const canUpdate = session.permissions.has("leads.update");
  const canDelete = session.permissions.has("leads.delete");
  const canTask = session.permissions.has("tasks.manage");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title={lead.title}
        description={
          [lead.destination, lead.customers?.name].filter(Boolean).join(" · ") || undefined
        }
        actions={
          <>
            <StatusBadge value={lead.status} />
            <StatusBadge value={lead.priority} />
            {lead.customers && (
              <Link
                href={`/customers/${lead.customers.id}`}
                className="text-primary text-sm underline"
              >
                {lead.customers.name}
              </Link>
            )}
            {session.permissions.has("itineraries.create") && (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={`/itineraries/new?lead=${id}`} />}
              >
                Create itinerary
              </Button>
            )}
            {canDelete && (
              <ConfirmActionButton
                action={deleteLeadAction.bind(null, id)}
                triggerLabel="Delete"
                title="Delete this lead?"
                description="This permanently removes the lead, its notes and activity history."
              />
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="bg-card rounded-xl border p-5 lg:col-span-2">
          {canUpdate ? (
            <EntityForm
              action={updateLeadAction.bind(null, id)}
              submitLabel="Save changes"
              fields={leadFields({ lead, customers, sources, team })}
            />
          ) : (
            <p className="text-muted-foreground text-sm">You have read-only access to this lead.</p>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Follow-ups & tasks</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {tasks.rows.length === 0 && (
                <p className="text-muted-foreground text-sm">No open tasks.</p>
              )}
              {tasks.rows.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                  <div>
                    <p className="font-medium">{t.title}</p>
                    <p className="text-muted-foreground text-xs">{t.due_date ?? "No due date"}</p>
                  </div>
                  {canTask && <TaskCompleteButton id={t.id} done={false} />}
                </div>
              ))}
              {canTask && (
                <EntityForm
                  action={createTaskAction}
                  submitLabel="Add follow-up"
                  hidden={{ relatedType: "LEAD", relatedId: id }}
                  fields={taskFields({ team, relatedId: id, compact: true })}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {canUpdate && (
                <EntityForm
                  action={addLeadNoteAction.bind(null, id)}
                  submitLabel="Add note"
                  fields={[{ name: "body", label: "New note", type: "textarea", required: true }]}
                />
              )}
              {timeline.notes.map((n) => (
                <div key={n.id} className="border-t pt-2 text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(n.created_at).toLocaleString("en-IN")}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm">
                {timeline.activities.map((a) => (
                  <li key={a.id}>
                    {a.summary}
                    <span className="text-muted-foreground block text-xs">
                      {new Date(a.created_at).toLocaleString("en-IN")}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
