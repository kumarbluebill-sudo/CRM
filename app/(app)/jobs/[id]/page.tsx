import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm } from "@/components/forms/entity-form";
import { AcceptJobButton, JobStatusForm } from "@/components/jobs/job-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import { label, options } from "@/lib/crm/constants";
import { uuid } from "@/lib/crm/schemas";
import { JOB_PRIORITIES, NEXT_STATUSES, OPEN_STATUSES, RELATED_TYPES } from "@/lib/jobs/constants";
import { getJob, getStaffDirectory, relatedHref } from "@/lib/jobs/queries";
import { addJobCommentAction, reassignJobAction, updateJobAction } from "@/app/(app)/jobs/actions";

export const metadata: Metadata = { title: "Job order" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  const data = await getJob(id); // null if missing, other organization, or not involved (row security)
  if (!data) notFound();
  const { job, events } = data;
  const directory = await getStaffDirectory();
  const person = new Map(directory.map((s) => [s.user_id, s]));
  const name = (uid: string | null) =>
    uid ? (person.get(uid)?.name ?? "Former staff") : "Unassigned";
  const can = (p: string) => session.permissions.has(p);
  const mine = job.assigned_to === session.userId;
  const manager = can("jobs.manage");
  const open = OPEN_STATUSES.includes(job.status);
  const assignee = job.assigned_to ? person.get(job.assigned_to) : undefined;
  let next = [...(NEXT_STATUSES[job.status] ?? [])] as string[];
  if (!(mine || manager)) next = [];
  if (job.status === "COMPLETED" && manager) next = ["IN_PROGRESS"];
  if (open && (manager || can("jobs.assign"))) next = [...next, "CANCELLED"];
  const link = relatedHref(job.related_type, job.related_id);
  const staffOptions = directory
    .filter((s) => s.active && s.user_id !== job.assigned_to)
    .map((s) => ({
      value: s.user_id,
      label: `${s.name}${s.designation ? ` · ${s.designation}` : ""}${s.open_jobs != null ? ` (${s.open_jobs} open)` : ""}`,
    }));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title={job.title}
        description={`${job.job_number} · created ${job.created_at.slice(0, 10)}`}
        actions={
          <>
            {job.is_overdue && <StatusBadge value="OVERDUE" />}
            {job.priority !== "NORMAL" && <StatusBadge value={job.priority} />}
            <StatusBadge value={job.status} />
            {mine && job.status === "ASSIGNED" && <AcceptJobButton id={job.id} />}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
              {(
                [
                  [
                    "Assigned to",
                    assignee
                      ? `${assignee.name}${assignee.designation ? ` · ${assignee.designation}` : ""}${assignee.department ? ` · ${assignee.department}` : ""}`
                      : "Unassigned",
                  ],
                  ["Team", job.assigned_team],
                  ["Assigned by", name(job.assigning_manager_id)],
                  ["Start", job.start_date],
                  [
                    "Deadline",
                    job.deadline ? `${job.deadline}${job.is_overdue ? " (overdue)" : ""}` : null,
                  ],
                  ["Completed", job.completed_at?.slice(0, 10)],
                ] as [string, string | null | undefined][]
              ).map(([k, v]) => (
                <div key={k}>
                  <p className="text-muted-foreground text-xs">{k}</p>
                  <p
                    className={
                      k === "Deadline" && job.is_overdue ? "font-semibold text-tone-bad" : ""
                    }
                  >
                    {v || "–"}
                  </p>
                </div>
              ))}
              <div>
                <p className="text-muted-foreground text-xs">Related record</p>
                <p>
                  {link ? (
                    <Link href={link} className="text-primary underline">
                      {RELATED_TYPES.find((r) => r.value === job.related_type)?.label ??
                        label(job.related_type ?? "")}
                    </Link>
                  ) : (
                    "–"
                  )}
                </p>
              </div>
              {job.customer_id && (
                <div>
                  <p className="text-muted-foreground text-xs">Customer</p>
                  <Link href={`/customers/${job.customer_id}`} className="text-primary underline">
                    Open customer
                  </Link>
                </div>
              )}
              {job.instructions && (
                <div className="sm:col-span-2">
                  <p className="text-muted-foreground text-xs">Instructions</p>
                  <p className="whitespace-pre-line">{job.instructions}</p>
                </div>
              )}
              {job.completion_notes && (
                <div className="sm:col-span-2">
                  <p className="text-muted-foreground text-xs">Completion notes</p>
                  <p className="whitespace-pre-line">{job.completion_notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">History and comments</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ol className="flex flex-col gap-3 text-sm" aria-label="Job history">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className="text-muted-foreground w-32 shrink-0 text-xs">
                      {e.created_at.slice(0, 16).replace("T", " ")}
                    </span>
                    <div>
                      <p>
                        <span className="font-medium">{name(e.actor_id)}</span>{" "}
                        {e.kind === "COMMENT"
                          ? "commented"
                          : e.kind === "CREATED"
                            ? "created the job"
                            : e.kind === "UPDATED"
                              ? "updated the details"
                              : e.kind === "ASSIGNED"
                                ? `assigned it to ${name((e.meta.to as string) ?? null)}`
                                : e.kind === "REASSIGNED"
                                  ? `reassigned it from ${name((e.meta.from as string) ?? null)} to ${name((e.meta.to as string) ?? null)}`
                                  : `changed status ${e.from_status ? `from ${label(e.from_status)} ` : ""}to ${label(e.to_status ?? "")}`}
                      </p>
                      {e.note && e.kind !== "CREATED" && (
                        <p className="text-muted-foreground text-xs whitespace-pre-line">
                          {e.note}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              <EntityForm
                action={addJobCommentAction.bind(null, job.id)}
                submitLabel="Add comment"
                fields={[{ name: "comment", label: "Add a comment", type: "textarea", wide: true }]}
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {next.length > 0 && (
            <Card>
              <CardContent>
                <JobStatusForm id={job.id} options={next} />
              </CardContent>
            </Card>
          )}
          {open && can("jobs.assign") && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reassign</CardTitle>
              </CardHeader>
              <CardContent>
                <EntityForm
                  action={reassignJobAction.bind(null, job.id)}
                  submitLabel="Reassign"
                  fields={[
                    {
                      name: "assignedTo",
                      label: "New assignee",
                      type: "select",
                      required: true,
                      options: staffOptions,
                      wide: true,
                    },
                    { name: "reason", label: "Reason", required: true, wide: true },
                  ]}
                />
              </CardContent>
            </Card>
          )}
          {open &&
            (manager ||
              job.created_by === session.userId ||
              job.assigning_manager_id === session.userId) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Edit details</CardTitle>
                </CardHeader>
                <CardContent>
                  <EntityForm
                    action={updateJobAction.bind(null, job.id)}
                    submitLabel="Save"
                    fields={[
                      { name: "title", label: "Title", defaultValue: job.title, wide: true },
                      {
                        name: "priority",
                        label: "Priority",
                        type: "select",
                        required: true,
                        options: options(JOB_PRIORITIES),
                        defaultValue: job.priority,
                        wide: true,
                      },
                      {
                        name: "startDate",
                        label: "Start date",
                        type: "date",
                        defaultValue: job.start_date,
                      },
                      {
                        name: "deadline",
                        label: "Deadline",
                        type: "date",
                        defaultValue: job.deadline,
                      },
                      {
                        name: "instructions",
                        label: "Instructions",
                        type: "textarea",
                        wide: true,
                        defaultValue: job.instructions,
                      },
                    ]}
                  />
                </CardContent>
              </Card>
            )}
        </div>
      </div>
    </div>
  );
}
