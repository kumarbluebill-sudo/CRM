import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { StatusBadge } from "@/components/crm/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { JOB_PRIORITIES, JOB_STATUSES } from "@/lib/jobs/constants";
import { getStaffDirectory, listJobs } from "@/lib/jobs/queries";

export const metadata: Metadata = { title: "Job orders" };

const sel =
  "border-input bg-background focus-visible:ring-ring/50 h-8 rounded-lg border px-2 text-sm outline-none focus-visible:ring-3";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("jobs.view")) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No access"
        description="You don't have permission to view job orders."
      />
    );
  }
  const sp = await searchParams;
  const directory = await getStaffDirectory();
  const names = new Map(directory.map((s) => [s.user_id, s]));
  const canSeeAll =
    session.permissions.has("jobs.assign") || session.permissions.has("jobs.manage");
  const departments = [...new Set(directory.map((s) => s.department).filter(Boolean))] as string[];
  const designations = [
    ...new Set(directory.map((s) => s.designation).filter(Boolean)),
  ] as string[];
  const group = sp.department
    ? { dept: sp.department }
    : sp.designation
      ? { desg: sp.designation }
      : null;
  const assigneeIds = group
    ? directory
        .filter((s) =>
          "dept" in group ? s.department === group.dept : s.designation === group.desg,
        )
        .map((s) => s.user_id)
    : undefined;

  const { rows, total, page } = await listJobs({
    status: sp.status,
    priority: sp.priority,
    assignee: sp.assignee,
    assigneeIds,
    mine: sp.scope === "mine" ? session.userId : undefined,
    overdue: sp.overdue === "1",
    q: sp.q?.slice(0, 60),
    page: Number.parseInt(sp.page ?? "1", 10) || 1,
  });
  const params = {
    status: sp.status,
    priority: sp.priority,
    assignee: sp.assignee,
    department: sp.department,
    designation: sp.designation,
    scope: sp.scope,
    overdue: sp.overdue,
    q: sp.q,
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Job orders"
        description={
          canSeeAll ? "Work assigned across the team." : "Jobs assigned to you or created by you."
        }
        actions={
          session.permissions.has("jobs.create") && (
            <Button size="sm" nativeButton={false} render={<Link href="/jobs/new" />}>
              <Plus className="size-4" aria-hidden /> New job order
            </Button>
          )
        }
      />

      <form
        className="flex flex-wrap items-end gap-2 text-xs"
        role="search"
        aria-label="Filter jobs"
      >
        <label className="flex flex-col gap-1">
          Search
          <input
            name="q"
            defaultValue={sp.q}
            maxLength={60}
            placeholder="Title or number"
            className={`${sel} w-44`}
          />
        </label>
        <label className="flex flex-col gap-1">
          Status
          <select name="status" defaultValue={sp.status ?? ""} className={sel}>
            <option value="">All</option>
            <option value="OPEN">Open (not finished)</option>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Priority
          <select name="priority" defaultValue={sp.priority ?? ""} className={sel}>
            <option value="">All</option>
            {JOB_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>
        </label>
        {canSeeAll && (
          <>
            <label className="flex flex-col gap-1">
              Staff member
              <select name="assignee" defaultValue={sp.assignee ?? ""} className={sel}>
                <option value="">Anyone</option>
                {directory.map((s) => (
                  <option key={s.user_id} value={s.user_id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {departments.length > 0 && (
              <label className="flex flex-col gap-1">
                Department
                <select name="department" defaultValue={sp.department ?? ""} className={sel}>
                  <option value="">Any</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {designations.length > 0 && (
              <label className="flex flex-col gap-1">
                Designation
                <select name="designation" defaultValue={sp.designation ?? ""} className={sel}>
                  <option value="">Any</option>
                  {designations.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        <label className="flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" name="scope" value="mine" defaultChecked={sp.scope === "mine"} />{" "}
          Mine only
        </label>
        <label className="flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" name="overdue" value="1" defaultChecked={sp.overdue === "1"} />{" "}
          Overdue only
        </label>
        <Button type="submit" size="sm">
          Apply
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<Link href="/jobs" />}
        >
          Clear
        </Button>
      </form>

      {canSeeAll && directory.some((s) => s.open_jobs !== null) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team workload</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Open, overdue and completed jobs per staff member
                </caption>
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th scope="col" className="py-1.5 font-medium">
                      Staff member
                    </th>
                    <th scope="col" className="font-medium">
                      Designation
                    </th>
                    <th scope="col" className="font-medium">
                      Department
                    </th>
                    <th scope="col" className="text-right font-medium">
                      Open
                    </th>
                    <th scope="col" className="text-right font-medium">
                      Overdue
                    </th>
                    <th scope="col" className="text-right font-medium">
                      Completed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {directory
                    .filter((s) => s.active || (s.open_jobs ?? 0) > 0)
                    .map((s) => (
                      <tr key={s.user_id} className="border-b last:border-0">
                        <th scope="row" className="py-1.5 text-left font-medium">
                          <Link href={`/jobs?assignee=${s.user_id}`} className="hover:underline">
                            {s.name}
                          </Link>
                          {!s.active && (
                            <span className="text-muted-foreground ml-1 text-xs font-normal">
                              (inactive)
                            </span>
                          )}
                        </th>
                        <td className="text-muted-foreground">{s.designation ?? "–"}</td>
                        <td className="text-muted-foreground">{s.department ?? "–"}</td>
                        <td className="text-right">{s.open_jobs ?? 0}</td>
                        <td
                          className={`text-right ${(s.overdue_jobs ?? 0) > 0 ? "font-semibold text-tone-bad" : ""}`}
                        >
                          {s.overdue_jobs ?? 0}
                        </td>
                        <td className="text-right">{s.completed_jobs ?? 0}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No jobs match"
              description="Try clearing the filters, or create a new job order."
            />
          ) : (
            <ul className="divide-y text-sm" aria-label="Job orders">
              {rows.map((j) => {
                const who = j.assigned_to ? names.get(j.assigned_to) : null;
                return (
                  <li key={j.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="text-muted-foreground w-24 shrink-0 text-xs">
                      {j.job_number}
                    </span>
                    <Link
                      href={`/jobs/${j.id}`}
                      className="min-w-48 flex-1 font-medium hover:underline"
                    >
                      {j.title}
                    </Link>
                    <span className="text-muted-foreground min-w-36 text-xs">
                      {who
                        ? `${who.name}${who.designation ? ` · ${who.designation}` : ""}`
                        : "Unassigned"}
                    </span>
                    <span
                      className={`text-xs ${j.is_overdue ? "font-semibold text-tone-bad" : "text-muted-foreground"}`}
                    >
                      {j.deadline ? `Due ${j.deadline}` : "No deadline"}
                    </span>
                    {j.priority !== "NORMAL" && <StatusBadge value={j.priority} />}
                    {j.is_overdue && <StatusBadge value="OVERDUE" />}
                    <StatusBadge value={j.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pagination page={page} total={total} basePath="/jobs" params={params} />
    </div>
  );
}
