import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { SegmentedTabs } from "@/components/crm/segmented-tabs";
import { StatusBadge } from "@/components/crm/status-badge";
import { TaskCompleteButton } from "@/components/crm/task-complete-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { listTeamMembers } from "@/lib/crm/queries";
import { todayInZone } from "@/lib/crm/followup-date";
import { listFollowups } from "@/lib/crm/followups";
import { getDisplayPrefs } from "@/lib/datetime/prefs";

export const metadata: Metadata = { title: "Follow-ups" };

export default async function FollowupsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const session = await requireOrgSession();
  const canTasks = session.permissions.has("tasks.view");
  const canLeads = session.permissions.has("leads.view");
  if (!canTasks && !canLeads) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="No access"
        description="You don't have permission to view follow-ups."
      />
    );
  }
  const done = (await searchParams).scope === "done";
  const [{ tasks, leads }, team, prefs] = await Promise.all([
    listFollowups({ done, tasks: canTasks, leads: canLeads }),
    listTeamMembers(),
    getDisplayPrefs(),
  ]);
  const today = todayInZone(new Date(), prefs.timeZone);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const canManage = session.permissions.has("tasks.manage");
  const when = (d: string | null) =>
    !d ? "No date" : d < today ? `${d} (overdue)` : d === today ? `${d} (today)` : d;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title="Follow-ups"
        description="Calls and reminders you owe customers. Dates set on a lead appear here too."
        actions={
          <SegmentedTabs
            label="Follow-up status"
            items={[
              { label: "Open", href: "/followups", active: !done },
              { label: "Done", href: "/followups?scope=done", active: done },
            ]}
          />
        }
      />

      {!done && canLeads && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leads waiting for a follow-up</CardTitle>
          </CardHeader>
          <CardContent>
            {leads.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No lead has a follow-up date set. Add a next follow-up date on a lead to see it
                here.
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {leads.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                  >
                    <div>
                      <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                        {l.contact_name ?? l.title}
                      </Link>
                      <p
                        className={`text-xs ${l.next_follow_up_date < today ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        <span className="font-mono">{l.reference_number}</span> ·{" "}
                        {when(l.next_follow_up_date)}
                        {l.assigned_user_id
                          ? ` · ${names.get(l.assigned_user_id) ?? "Teammate"}`
                          : ""}
                        {l.contact_phone ? ` · ${l.contact_phone}` : ""}
                      </p>
                    </div>
                    <StatusBadge value={l.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {canTasks && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {done ? "Completed follow-ups" : "Scheduled follow-ups"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <EmptyState
                icon={CalendarCheck}
                title={done ? "Nothing completed yet" : "You're all caught up"}
                description={done ? undefined : "Add a follow-up from a lead, customer or booking."}
              />
            ) : (
              <ul className="flex flex-col divide-y">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.title}</p>
                      <p
                        className={`text-xs ${!done && t.due_date && t.due_date < today ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {when(t.due_date)}
                        {t.assigned_to ? ` · ${names.get(t.assigned_to) ?? "Teammate"}` : ""}
                      </p>
                      {t.related_type === "LEAD" && t.related_id && (
                        <Link
                          href={`/leads/${t.related_id}`}
                          className="text-primary text-xs underline"
                        >
                          Open lead
                        </Link>
                      )}
                      {t.related_type === "BOOKING" && t.related_id && (
                        <Link
                          href={`/bookings/${t.related_id}`}
                          className="text-primary text-xs underline"
                        >
                          Open booking
                        </Link>
                      )}
                      {t.related_type === "VISA_APPLICATION" && t.related_id && (
                        <Link
                          href={`/visa/applications/${t.related_id}`}
                          className="text-primary text-xs underline"
                        >
                          Open visa application
                        </Link>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge value={t.priority} />
                      {canManage && <TaskCompleteButton id={t.id} done={done} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
