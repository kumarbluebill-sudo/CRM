import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm, type FormField } from "@/components/forms/entity-form";
import { taskFields } from "@/components/crm/task-fields";
import {
  DeleteApplicationButton,
  RemoveChecklistButton,
  RemoveTravellerButton,
  RequestDocumentButton,
  ReviewPanel,
  StatusButtons,
  UploadButton,
} from "@/components/visa/visa-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import { label, options } from "@/lib/crm/constants";
import { listTeamMembers } from "@/lib/crm/queries";
import { uuid } from "@/lib/crm/schemas";
import { createTaskAction } from "@/app/(app)/tasks/actions";
import { DeliveryTab, MessagesTab, PaymentsTab, PricingTab, SupplierTab } from "./commerce-tabs";
import {
  APPLICANT_TYPES,
  PRIORITIES,
  VISA_TRANSITIONS,
  isTravelUrgent,
  passportWarning,
  type ApplicationStatus,
} from "@/lib/visa/constants";
import { maskPassport } from "@/lib/visa/mask";
import {
  getApplication,
  listApplicationTasks,
  listChecklist,
  listEvents,
  listTravellers,
  personName,
  type ChecklistRow,
  type IdentityRow,
  type TravellerRow,
} from "@/lib/visa/queries";
import {
  addChecklistItemAction,
  addTravellerAction,
  assignApplicationAction,
  updateApplicationNotesAction,
  updateTravellerAction,
} from "@/app/(app)/visa/actions";

export const metadata: Metadata = { title: "Visa application" };

const TABS = [
  "overview",
  "travellers",
  "documents",
  "pricing",
  "payments",
  "processing",
  "supplier",
  "delivery",
  "messages",
  "tasks",
  "notes",
  "timeline",
] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  travellers: "Travellers",
  documents: "Documents",
  pricing: "Pricing",
  payments: "Payments",
  processing: "Processing",
  supplier: "Supplier",
  delivery: "Delivery",
  messages: "Messages",
  tasks: "Tasks",
  notes: "Notes",
  timeline: "Timeline",
};

const DONE = new Set(["APPROVED", "NOT_REQUIRED"]);
const WAITING_FOR_FILE = new Set([
  "PENDING",
  "REQUESTED",
  "REJECTED",
  "CORRECTION_REQUIRED",
  "EXPIRED",
]);

function travellerFields(
  t: TravellerRow | undefined,
  id: IdentityRow | undefined,
  withPassport: boolean,
): FormField[] {
  const f: FormField[] = [
    { name: "first_name", label: "First name", required: true, defaultValue: t?.first_name },
    { name: "middle_name", label: "Middle name", defaultValue: t?.middle_name },
    { name: "last_name", label: "Last name", defaultValue: t?.last_name },
    { name: "date_of_birth", label: "Date of birth", type: "date", defaultValue: t?.date_of_birth },
    {
      name: "gender",
      label: "Gender",
      type: "select",
      defaultValue: t?.gender,
      options: [
        { value: "MALE", label: "Male" },
        { value: "FEMALE", label: "Female" },
        { value: "OTHER", label: "Other" },
      ],
    },
    { name: "nationality", label: "Nationality", defaultValue: t?.nationality },
    {
      name: "applicant_type",
      label: "Applicant type",
      type: "select",
      defaultValue: t?.applicant_type,
      options: options(APPLICANT_TYPES),
    },
    { name: "email", label: "Email", type: "email", defaultValue: t?.email },
    { name: "mobile", label: "Mobile", type: "tel", defaultValue: t?.mobile },
    { name: "occupation", label: "Occupation", defaultValue: t?.occupation },
    { name: "address", label: "Address", wide: true, defaultValue: t?.address },
    {
      name: "previous_visa",
      label: "Previous visas",
      type: "textarea",
      wide: true,
      defaultValue: t?.previous_visa,
    },
    {
      name: "previous_travel",
      label: "Previous travel",
      type: "textarea",
      wide: true,
      defaultValue: t?.previous_travel,
    },
  ];
  if (withPassport)
    f.push(
      { name: "passport_number", label: "Passport number", defaultValue: id?.passport_number },
      { name: "passport_country", label: "Issuing country", defaultValue: id?.issuing_country },
      {
        name: "passport_issue_date",
        label: "Passport issued",
        type: "date",
        defaultValue: id?.issue_date,
      },
      {
        name: "passport_expiry_date",
        label: "Passport expires",
        type: "date",
        defaultValue: id?.expiry_date,
      },
    );
  return f;
}

export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  const app = await getApplication(id);
  if (!app) notFound();
  const tabParam = (await searchParams).tab;
  const tab = TABS.find((t) => t === tabParam) ?? "overview";

  const p = session.permissions;
  const status = app.status as ApplicationStatus;
  const closed = status === "CLOSED" || status === "CANCELLED";
  const canEdit = p.has("visa.edit") && !closed;
  const canUpload = p.has("visa.document.upload") && !closed;
  const canDocView = p.has("visa.document.view");

  const [{ travellers, identity }, checklist, team] = await Promise.all([
    listTravellers(id),
    listChecklist(id),
    listTeamMembers(),
  ]);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const required = checklist.filter((c) => c.required && c.status !== "NOT_REQUIRED");
  const approved = required.filter((c) => DONE.has(c.status)).length;
  const minMonths = app.visa_products?.passport_validity_months ?? 6;
  const warnings = travellers.flatMap((t) => {
    const w = passportWarning(identity.get(t.id)?.expiry_date ?? null, app.travel_date, minMonths);
    return w ? [`${personName(t)}: ${w}`] : [];
  });
  const urgent = isTravelUrgent(app.travel_date, status);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title={app.application_number}
        description={`${app.visa_countries?.name ?? ""} · ${label(app.visa_type)} · ${app.customers?.name ?? ""}`}
        actions={
          <>
            <StatusBadge value={status} />
            {app.priority !== "NORMAL" && <StatusBadge value={app.priority} />}
            {p.has("jobs.create") && (
              <Link
                href={`/jobs/new?relatedType=VISA_APPLICATION&relatedId=${id}&customerId=${app.customer_id}`}
                className="text-primary text-sm underline"
              >
                Create job order
              </Link>
            )}
          </>
        }
      />

      {(urgent ||
        warnings.length > 0 ||
        checklist.some((c) => c.status === "CORRECTION_REQUIRED" || c.status === "REJECTED")) && (
        <div
          role="note"
          className="border-tone-warn/30 bg-tone-warn-soft text-tone-warn flex gap-3 rounded-lg border p-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <ul className="flex flex-col gap-1">
            {urgent && (
              <li>Travel date is within a week and the application hasn&apos;t been submitted.</li>
            )}
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
            {checklist.some(
              (c) => c.status === "CORRECTION_REQUIRED" || c.status === "REJECTED",
            ) && <li>Some documents need correcting.</li>}
          </ul>
        </div>
      )}

      <nav aria-label="Application sections" className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/visa/applications/${id}?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${t === tab ? "border-primary font-medium" : "text-muted-foreground hover:text-foreground border-transparent"}`}
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <Card>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              [
                "Customer",
                app.customers ? (
                  <Link
                    key="c"
                    href={`/customers/${app.customer_id}`}
                    className="text-primary underline"
                  >
                    {app.customers.name}
                  </Link>
                ) : (
                  "–"
                ),
              ],
              ["Country", app.visa_countries?.name],
              [
                "Visa",
                `${label(app.visa_type)}${app.visa_products ? ` · ${label(app.visa_products.entry_type)} entry` : ""}`,
              ],
              ["Nationality", app.nationality],
              ["Travel date", app.travel_date],
              ["Travellers", `${travellers.length} added (${app.travellers_planned} planned)`],
              ["Sales", app.sales_user_id ? names.get(app.sales_user_id) : "Unassigned"],
              [
                "Visa processor",
                app.processor_user_id ? names.get(app.processor_user_id) : "Unassigned",
              ],
              ["Manager", app.manager_user_id ? names.get(app.manager_user_id) : "Unassigned"],
              ["Documents approved", `${approved} / ${required.length} required`],
              ["Expected completion", app.expected_completion],
              [
                "Processing time",
                app.visa_products?.processing_days_normal != null
                  ? `${app.visa_products.processing_days_normal} working days (indicative)`
                  : "Not set",
              ],
              ["Created", app.created_at.slice(0, 10)],
            ].map(([k, v]) => (
              <div key={k as string}>
                <p className="text-muted-foreground text-xs">{k}</p>
                <p>{v || "–"}</p>
              </div>
            ))}
            {app.status_reason && (
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="text-muted-foreground text-xs">Last status reason</p>
                <p>{app.status_reason}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "travellers" && (
        <section aria-label="Travellers" className="flex flex-col gap-4">
          {travellers.map((t) => {
            const ident = identity.get(t.id);
            const warn = passportWarning(ident?.expiry_date ?? null, app.travel_date, minMonths);
            return (
              <Card key={t.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-3 text-base">
                    <span>{personName(t)}</span>
                    {t.is_lead && (
                      <span className="text-muted-foreground text-xs font-normal">
                        Lead traveller
                      </span>
                    )}
                    <span className="text-muted-foreground text-xs font-normal">
                      {label(t.applicant_type)}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      {canDocView && (
                        <span className="text-xs font-normal">
                          Passport {ident ? maskPassport(ident.passport_number) : "not recorded"}
                          {ident?.expiry_date ? ` · expires ${ident.expiry_date}` : ""}
                        </span>
                      )}
                      {canEdit && travellers.length > 1 && (
                        <RemoveTravellerButton
                          applicationId={id}
                          travellerId={t.id}
                          name={personName(t)}
                        />
                      )}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {warn && <p className="text-tone-bad text-sm">{warn}</p>}
                  <p className="text-muted-foreground text-sm">
                    {[t.nationality, t.date_of_birth, t.mobile, t.email]
                      .filter(Boolean)
                      .join(" · ") || "No contact details yet."}
                  </p>
                  {canEdit && (
                    <details className="rounded-lg border p-3">
                      <summary className="cursor-pointer text-sm font-medium">Edit details</summary>
                      <div className="pt-3">
                        <EntityForm
                          action={updateTravellerAction.bind(null, id, t.id)}
                          submitLabel="Save traveller"
                          fields={travellerFields(
                            t,
                            ident,
                            canDocView && p.has("visa.document.upload"),
                          )}
                        />
                      </div>
                    </details>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {canEdit && (
            <details className="bg-card rounded-xl border p-4">
              <summary className="cursor-pointer text-sm font-medium">Add a traveller</summary>
              <div className="pt-3">
                <EntityForm
                  action={addTravellerAction.bind(null, id)}
                  submitLabel="Add traveller"
                  fields={travellerFields(
                    undefined,
                    undefined,
                    canDocView && p.has("visa.document.upload"),
                  )}
                />
              </div>
            </details>
          )}
        </section>
      )}

      {tab === "documents" && (
        <section aria-label="Documents" className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p>
                <strong>{approved}</strong> of <strong>{required.length}</strong> required documents
                approved
              </p>
              <div
                className="bg-muted h-2 overflow-hidden rounded-full"
                role="progressbar"
                aria-label="Required documents approved"
                aria-valuenow={required.length ? Math.round((approved / required.length) * 100) : 0}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="bg-primary h-full"
                  style={{ width: `${required.length ? (approved / required.length) * 100 : 0}%` }}
                />
              </div>
            </CardContent>
          </Card>
          {checklist.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No checklist yet. The product has no document requirements configured; add them under
              Products, or add lines below.
            </p>
          )}
          {groupBy(checklist, (c) =>
            c.traveller_id ? personName(c.visa_travellers) : "Application",
          ).map(([who, rows]) => (
            <Card key={who}>
              <CardHeader>
                <CardTitle className="text-base">{who}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {rows.map((c) => (
                    <li key={c.id} className="flex flex-col gap-1 py-2.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="min-w-40 font-medium">{c.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {c.required ? "Required" : "Optional"}
                        </span>
                        <StatusBadge value={c.status} />
                        {c.documents && (
                          <span className="text-muted-foreground truncate text-xs">
                            {c.documents.name} · {(c.documents.size_bytes / 1024).toFixed(0)} KB
                          </span>
                        )}
                        <span className="ml-auto flex flex-wrap items-center gap-1">
                          {canUpload &&
                            (WAITING_FOR_FILE.has(c.status) ||
                              c.status === "UPLOADED" ||
                              c.status === "UNDER_REVIEW") && (
                              <UploadButton itemId={c.id} replace={Boolean(c.document_id)} />
                            )}
                          {c.document_id &&
                            c.documents &&
                            canDocView &&
                            !(p.has("visa.document.approve") || p.has("visa.document.reject")) && (
                              <Button
                                size="xs"
                                variant="outline"
                                nativeButton={false}
                                render={
                                  <a
                                    href={`/api/documents/${c.document_id}/download?inline=1`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  />
                                }
                              >
                                View
                              </Button>
                            )}
                          {c.document_id &&
                            c.documents &&
                            !closed &&
                            (p.has("visa.document.approve") || p.has("visa.document.reject")) && (
                              <ReviewPanel
                                applicationId={id}
                                itemId={c.id}
                                documentId={c.document_id}
                                mime={c.documents.mime_type}
                                name={`${who}: ${c.name}`}
                                canApprove={p.has("visa.document.approve")}
                                canReject={p.has("visa.document.reject")}
                              />
                            )}
                          {canEdit && c.status === "PENDING" && (
                            <RequestDocumentButton applicationId={id} itemId={c.id} />
                          )}
                          {canEdit && !c.required && (
                            <RemoveChecklistButton applicationId={id} itemId={c.id} />
                          )}
                        </span>
                      </div>
                      {c.review_note && (
                        <p className="text-muted-foreground text-xs">
                          Reviewer note: {c.review_note}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
          {canEdit && (
            <details className="bg-card rounded-xl border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Add a document to the checklist
              </summary>
              <div className="pt-3">
                <EntityForm
                  action={addChecklistItemAction.bind(null, id)}
                  submitLabel="Add to checklist"
                  fields={[
                    {
                      name: "name",
                      label: "Document",
                      required: true,
                      placeholder: "e.g. Employment letter",
                    },
                    {
                      name: "travellerId",
                      label: "For",
                      type: "select",
                      options: travellers.map((t) => ({ value: t.id, label: personName(t) })),
                    },
                    { name: "required", label: "Required", type: "checkbox" },
                  ]}
                />
              </div>
            </details>
          )}
        </section>
      )}

      {tab === "processing" && (
        <section aria-label="Processing" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-sm">
                Current: <StatusBadge value={status} />
              </p>
              {p.has("visa.process") ? (
                <>
                  <StatusButtons
                    applicationId={id}
                    canProcess
                    next={VISA_TRANSITIONS[status].filter(
                      (s) =>
                        s !== "DELIVERED" && // recorded on the Delivery tab, which also keeps the proof
                        (s !== "SUBMITTED" || p.has("visa.application.submit")) &&
                        (s !== "CLOSED" || p.has("visa.application.close")),
                    )}
                  />
                  {status === "DOCUMENT_REVIEW" && approved < required.length && (
                    <p className="text-muted-foreground text-xs">
                      Ready for submission unlocks once every required document is approved (
                      {approved} of {required.length}).
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  You can view the status but not change it.
                </p>
              )}
            </CardContent>
          </Card>
          {p.has("visa.application.assign") && !closed && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Assignment</CardTitle>
              </CardHeader>
              <CardContent>
                <EntityForm
                  action={assignApplicationAction.bind(null, id)}
                  submitLabel="Save assignment"
                  fields={(["salesId", "processorId", "managerId"] as const).map((name) => ({
                    name,
                    label: {
                      salesId: "Sales",
                      processorId: "Visa processor",
                      managerId: "Manager",
                    }[name],
                    type: "select" as const,
                    defaultValue: {
                      salesId: app.sales_user_id,
                      processorId: app.processor_user_id,
                      managerId: app.manager_user_id,
                    }[name],
                    options: team.map((m) => ({ value: m.userId, label: m.name })),
                  }))}
                />
              </CardContent>
            </Card>
          )}
          {p.has("visa.delete") && ["DRAFT", "NEW", "CANCELLED"].includes(status) && (
            <DeleteApplicationButton applicationId={id} />
          )}
        </section>
      )}

      {tab === "pricing" && <PricingTab app={app} p={p} travellerCount={travellers.length} />}
      {tab === "payments" && <PaymentsTab app={app} p={p} />}
      {tab === "supplier" && <SupplierTab app={app} p={p} />}
      {tab === "delivery" && <DeliveryTab app={app} p={p} travellers={travellers} names={names} />}
      {tab === "messages" && <MessagesTab app={app} p={p} />}

      {tab === "tasks" && (
        <section aria-label="Tasks" className="flex flex-col gap-4">
          <TasksTab id={id} team={team} canManage={p.has("tasks.manage")} />
        </section>
      )}

      {tab === "notes" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes and priority</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              Internal notes are for staff only and are never shown to the customer.
            </p>
            {p.has("visa.edit") ? (
              <EntityForm
                action={updateApplicationNotesAction.bind(null, id)}
                submitLabel="Save"
                fields={[
                  {
                    name: "priority",
                    label: "Priority",
                    type: "select",
                    required: true,
                    options: options(PRIORITIES),
                    defaultValue: app.priority,
                  },
                  {
                    name: "travelDate",
                    label: "Travel date",
                    type: "date",
                    defaultValue: app.travel_date,
                  },
                  {
                    name: "internalNotes",
                    label: "Internal notes",
                    type: "textarea",
                    wide: true,
                    defaultValue: app.internal_notes,
                  },
                  {
                    name: "customerNotes",
                    label: "Notes for the customer",
                    type: "textarea",
                    wide: true,
                    defaultValue: app.customer_notes,
                  },
                ]}
              />
            ) : (
              <p className="text-sm whitespace-pre-line">{app.internal_notes || "No notes."}</p>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "timeline" && <TimelineTab id={id} names={names} />}
    </div>
  );
}

function groupBy<T>(rows: T[], key: (r: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()];
}

async function TasksTab({
  id,
  team,
  canManage,
}: {
  id: string;
  team: { userId: string; name: string }[];
  canManage: boolean;
}) {
  const tasks = await listApplicationTasks(id);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  return (
    <>
      <Card>
        <CardContent>
          {tasks.length === 0 ? (
            <p className="text-muted-foreground text-sm">No follow-ups or tasks yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium">{t.title}</span>
                  <span className="text-muted-foreground">
                    {t.kind === "FOLLOWUP" ? "Follow-up" : "Task"} · {t.due_date ?? "no due date"}
                    {t.assigned_to ? ` · ${names.get(t.assigned_to) ?? ""}` : ""}
                  </span>
                  <span className="ml-auto">
                    <StatusBadge value={t.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {canManage && (
        <details className="bg-card rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">Add a follow-up or task</summary>
          <div className="pt-3">
            <EntityForm
              action={createTaskAction}
              submitLabel="Add"
              hidden={{ relatedType: "VISA_APPLICATION", relatedId: id }}
              fields={taskFields({ team, compact: true, relatedId: id })}
            />
          </div>
        </details>
      )}
    </>
  );
}

async function TimelineTab({ id, names }: { id: string; names: Map<string, string> }) {
  const events = await listEvents(id);
  return (
    <Card>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>
        ) : (
          <ol className="flex flex-col gap-3 text-sm" aria-label="Application timeline">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="text-muted-foreground w-36 shrink-0 text-xs">
                  {e.created_at.slice(0, 16).replace("T", " ")}
                </span>
                <span>
                  {e.summary}
                  {e.actor_id && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {names.get(e.actor_id) ?? "Staff"}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export type { ChecklistRow };
