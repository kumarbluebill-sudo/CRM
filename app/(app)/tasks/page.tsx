import type { Metadata } from "next";
import Link from "next/link";
import { CheckSquare } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { StatusBadge } from "@/components/crm/status-badge";
import { TaskCompleteButton } from "@/components/crm/task-complete-button";
import { taskFields } from "@/components/crm/task-fields";
import { EntityForm } from "@/components/forms/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { listTasks, listTeamMembers } from "@/lib/crm/queries";
import { createTaskAction } from "@/app/(app)/tasks/actions";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; page?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("tasks.view")) {
    return (
      <EmptyState
        icon={CheckSquare}
        title="No access"
        description="You don't have permission to view tasks."
      />
    );
  }
  const sp = await searchParams;
  const scope = sp.scope === "done" ? "done" : "open";
  const [{ rows, total, page }, team] = await Promise.all([
    listTasks({ scope, page: Number.parseInt(sp.page ?? "1", 10) || 1 }),
    listTeamMembers(),
  ]);
  const canManage = session.permissions.has("tasks.manage");
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title="Tasks & follow-ups"
        actions={
          <>
            <Button
              size="sm"
              variant={scope === "open" ? "secondary" : "outline"}
              nativeButton={false}
              render={<Link href="/tasks?scope=open" />}
            >
              Open
            </Button>
            <Button
              size="sm"
              variant={scope === "done" ? "secondary" : "outline"}
              nativeButton={false}
              render={<Link href="/tasks?scope=done" />}
            >
              Done
            </Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">
          {rows.length === 0 && (
            <Card>
              <CardContent>
                <EmptyState
                  icon={CheckSquare}
                  title={scope === "open" ? "You're all caught up" : "Nothing completed yet"}
                />
              </CardContent>
            </Card>
          )}
          {rows.map((t) => {
            const overdue = scope === "open" && t.due_date && t.due_date < today;
            return (
              <Card key={t.id} size="sm">
                <CardContent className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.title}</p>
                    <p
                      className={`text-xs ${overdue ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {t.kind === "FOLLOWUP" ? "Follow-up" : "Task"} · {t.due_date ?? "No due date"}
                      {overdue ? " (overdue)" : ""}
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
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge value={t.priority} />
                    {canManage && <TaskCompleteButton id={t.id} done={scope === "done"} />}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          <Pagination page={page} total={total} basePath="/tasks" params={{ scope }} />
        </div>
        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New task</CardTitle>
            </CardHeader>
            <CardContent>
              <EntityForm
                action={createTaskAction}
                submitLabel="Create task"
                fields={taskFields({ team })}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
