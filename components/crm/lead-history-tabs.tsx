import Link from "next/link";
import { LocalTime } from "@/components/datetime/local-time";
import { enquiryFields } from "@/components/crm/enquiry-fields";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { label } from "@/lib/crm/constants";
import type { LeadHistory } from "@/lib/crm/lead-history";
import { buildTimeline } from "@/lib/crm/timeline";
import type { LeadRow, Option, TeamMember } from "@/lib/crm/types";
import { formatMoney } from "@/lib/quotation/pricing";
import {
  createEnquiryAction,
  linkToEnquiryAction,
  updateEnquiryAction,
} from "@/app/(app)/leads/enquiry-actions";

export const HISTORY_TABS = [
  { key: "overview", label: "Overview" },
  { key: "enquiries", label: "Enquiry History" },
  { key: "bookings", label: "Booking History" },
  { key: "itineraries", label: "Itinerary History" },
  { key: "quotations", label: "Quotation History" },
  { key: "followups", label: "Follow-up History" },
  { key: "timeline", label: "Activity Timeline" },
] as const;
export type HistoryTab = (typeof HISTORY_TABS)[number]["key"];

type Props = {
  tab: Exclude<HistoryTab, "overview">;
  lead: LeadRow;
  history: LeadHistory;
  team: TeamMember[];
  sources: Option[];
  canUpdate: boolean;
};

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="text-muted-foreground py-6 text-center text-sm">{children}</p>
);

const dates = (a: string | null, b: string | null) =>
  a || b ? `${a ?? "…"} to ${b ?? "…"}` : "Dates not set";

export function LeadHistoryTab({ tab, lead, history, team, sources, canUpdate }: Props) {
  const nameOf = (id: string | null | undefined) => team.find((m) => m.userId === id)?.name ?? null;

  if (tab === "enquiries") {
    const quotes = history.quotations;
    const itins = history.itineraries;
    return (
      <div className="flex flex-col gap-4">
        {history.enquiries.length === 0 && (
          <Card>
            <CardContent>
              <Empty>
                No enquiries recorded for this lead yet. Add one below to start a history of what
                the customer has asked for.
              </Empty>
            </CardContent>
          </Card>
        )}
        {history.enquiries.map((e) => {
          const linkedQ = quotes.filter((q) => q.enquiry_id === e.id);
          const linkedI = itins.filter((i) => i.enquiry_id === e.id);
          const unlinked: Option[] = [
            ...quotes
              .filter((q) => !q.enquiry_id)
              .map((q) => ({
                value: `quotation:${q.id}`,
                label: `Quotation ${q.quotation_number}`,
              })),
            ...itins
              .filter((i) => !i.enquiry_id)
              .map((i) => ({ value: `itinerary:${i.id}`, label: `Itinerary ${i.title}` })),
          ];
          return (
            <Card key={e.id}>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  <span className="font-mono text-sm">{e.enquiry_number}</span>{" "}
                  <span className="text-muted-foreground text-sm font-normal">
                    · {e.enquiry_date}
                  </span>
                </CardTitle>
                <StatusBadge value={e.status} />
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground inline">Destination: </dt>
                    <dd className="inline">{e.destination ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">Travel dates: </dt>
                    <dd className="inline">{dates(e.departure_date, e.return_date)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">Travellers: </dt>
                    <dd className="inline">{e.travellers ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">Source: </dt>
                    <dd className="inline">
                      {sources.find((s) => s.value === e.lead_source_id)?.label ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">Assigned: </dt>
                    <dd className="inline">{nameOf(e.assigned_user_id) ?? "—"}</dd>
                  </div>
                  {e.lost_reason && (
                    <div>
                      <dt className="text-muted-foreground inline">Lost because: </dt>
                      <dd className="inline">{e.lost_reason}</dd>
                    </div>
                  )}
                </dl>
                {e.requirements && <p className="whitespace-pre-wrap">{e.requirements}</p>}
                <div>
                  <p className="text-muted-foreground text-xs uppercase">Related documents</p>
                  {linkedQ.length + linkedI.length === 0 ? (
                    <p className="text-muted-foreground">
                      No quotations or itineraries linked yet.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {linkedQ.map((q) => (
                        <li key={q.id}>
                          <Link href={`/quotations/${q.id}`} className="text-primary underline">
                            Quotation {q.quotation_number}
                          </Link>{" "}
                          <StatusBadge value={q.status} />
                        </li>
                      ))}
                      {linkedI.map((i) => (
                        <li key={i.id}>
                          <Link href={`/itineraries/${i.id}`} className="text-primary underline">
                            Itinerary {i.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {canUpdate && unlinked.length > 0 && (
                  <EntityForm
                    action={linkToEnquiryAction.bind(null, lead.id, e.id)}
                    submitLabel="Link to this enquiry"
                    fields={[
                      {
                        name: "item",
                        label: "Link a quotation or itinerary of this lead",
                        type: "select",
                        required: true,
                        options: unlinked,
                      },
                    ]}
                  />
                )}
                {canUpdate && (
                  <details className="rounded-lg border p-3">
                    <summary className="cursor-pointer text-sm font-medium">Edit enquiry</summary>
                    <div className="pt-3">
                      <EntityForm
                        action={updateEnquiryAction.bind(null, lead.id, e.id)}
                        submitLabel="Save enquiry"
                        fields={enquiryFields({ enquiry: e, sources, team })}
                      />
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })}
        {canUpdate && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add an enquiry</CardTitle>
            </CardHeader>
            <CardContent>
              <EntityForm
                action={createEnquiryAction.bind(null, lead.id)}
                submitLabel="Add enquiry"
                fields={enquiryFields({ lead, sources, team })}
              />
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  if (tab === "bookings") {
    return (
      <Card>
        <CardContent>
          {history.bookings.length === 0 ? (
            <Empty>No bookings have been made from this lead.</Empty>
          ) : (
            <ul className="flex flex-col divide-y">
              {history.bookings.map((b) => {
                const payment =
                  b.total_amount > 0 && b.paid_amount >= b.total_amount
                    ? "Paid in full"
                    : b.paid_amount > 0
                      ? "Partly paid"
                      : "Unpaid";
                return (
                  <li key={b.id} className="flex flex-col gap-1 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/bookings/${b.id}`} className="font-medium hover:underline">
                        <span className="font-mono">{b.booking_number}</span> · {b.title}
                      </Link>
                      <StatusBadge value={b.status} />
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Booked <LocalTime value={b.created_at} /> ·{" "}
                      {b.destination ?? "No destination"} · {dates(b.travel_start, b.travel_end)} ·{" "}
                      {b.adults + b.children} travellers
                    </p>
                    <p className="text-xs">
                      {formatMoney(b.total_amount, b.currency)} · {payment} (
                      {formatMoney(b.paid_amount, b.currency)} received) · Assigned:{" "}
                      {nameOf(lead.assigned_user_id) ?? "—"}
                    </p>
                    <p className="text-xs">
                      <Link href={`/bookings/${b.id}`} className="text-primary underline">
                        Booking details and documents
                      </Link>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  if (tab === "itineraries") {
    return (
      <Card>
        <CardContent>
          {history.itineraries.length === 0 ? (
            <Empty>No itineraries have been prepared for this lead.</Empty>
          ) : (
            <ul className="flex flex-col divide-y">
              {history.itineraries.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div>
                    <Link href={`/itineraries/${i.id}`} className="font-medium hover:underline">
                      {i.title}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {i.destination ?? "No destination"} · version {i.version} · created{" "}
                      <LocalTime value={i.created_at} />
                    </p>
                  </div>
                  <StatusBadge value={i.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  if (tab === "quotations") {
    return (
      <Card>
        <CardContent>
          {history.quotations.length === 0 ? (
            <Empty>No quotations have been prepared for this lead.</Empty>
          ) : (
            <ul className="flex flex-col divide-y">
              {history.quotations.map((q) => (
                <li
                  key={q.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div>
                    <Link href={`/quotations/${q.id}`} className="font-medium hover:underline">
                      <span className="font-mono">{q.quotation_number}</span> · {q.title}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      Version {q.version} · created <LocalTime value={q.created_at} />
                      {q.sent_at && (
                        <>
                          {" "}
                          · sent <LocalTime value={q.sent_at} />
                        </>
                      )}
                    </p>
                  </div>
                  <StatusBadge value={q.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  if (tab === "followups") {
    return (
      <Card>
        <CardContent>
          {history.tasks.length === 0 ? (
            <Empty>No follow-ups or tasks have been recorded for this lead.</Empty>
          ) : (
            <ul className="flex flex-col divide-y">
              {history.tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{t.title}</p>
                    <p className="text-muted-foreground text-xs">
                      {t.kind === "FOLLOWUP" ? "Follow-up" : "Task"} · due {t.due_date ?? "no date"}
                      {nameOf(t.assigned_to) ? ` · ${nameOf(t.assigned_to)}` : ""}
                      {t.completed_at && (
                        <>
                          {" "}
                          · completed <LocalTime value={t.completed_at} />
                        </>
                      )}
                    </p>
                  </div>
                  <StatusBadge value={t.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  const events = buildTimeline(history.sources, nameOf);
  return (
    <Card>
      <CardContent>
        {events.length === 0 ? (
          <Empty>No activity has been recorded for this lead yet.</Empty>
        ) : (
          <ol className="flex flex-col divide-y">
            {events.map((e) => (
              <li key={e.key} className="flex flex-col gap-0.5 py-3 text-sm">
                <p className="font-medium">
                  {e.href ? (
                    <Link href={e.href} className="hover:underline">
                      {e.title}
                    </Link>
                  ) : (
                    e.title
                  )}{" "}
                  <span className="text-muted-foreground text-xs font-normal">
                    · {label(e.type)}
                  </span>
                </p>
                {e.detail && <p className="whitespace-pre-wrap">{e.detail}</p>}
                <p className="text-muted-foreground text-xs">
                  <LocalTime value={e.at} />
                  {e.by ? ` · ${e.by}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
