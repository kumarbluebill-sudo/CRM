import { redactForAiText } from "@/lib/ai/redact";

/**
 * Turns CRM rows into the text the assistant sees. Only fields staff can already see on the booking/lead page are
 * included, and deliberately NOT: contact details, passport data, supplier names or costs, quotation profit,
 * internal payment references. Free text typed by people (notes, activity summaries) is redacted and truncated,
 * and the whole block is wrapped in <crm_data> so the model treats it as data.
 */

const LIMIT = 8000;
/** Structured fields (dates, amounts, statuses) are passed through; free text typed by people is redacted. */
const clip = (v: unknown, n = 300) => String(v ?? "").slice(0, n);
const free = (v: unknown, n = 300) => redactForAiText(String(v ?? "")).slice(0, n);
const line = (k: string, v: unknown, redact = false) =>
  v === null || v === undefined || v === "" ? null : `${k}: ${redact ? free(v) : clip(v)}`;
const money = (n: unknown, cur: unknown) => `${cur ?? ""} ${Number(n ?? 0).toFixed(2)}`.trim();

export function wrapCrmData(lines: (string | null)[]): string {
  const body = lines
    .filter((l): l is string => l !== null)
    .join("\n")
    .slice(0, LIMIT);
  // The closing tag can't appear inside the data: strip any attempt to fake it.
  return `<crm_data>\n${body.replace(/<\/?crm_data>/gi, "")}\n</crm_data>`;
}

export type BookingContextInput = {
  booking: Record<string, unknown> & { customers?: { name?: string } | null };
  items: Record<string, unknown>[];
  schedule: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  canSeeMoney: boolean;
};

export function bookingContext(i: BookingContextInput): string {
  const b = i.booking;
  const lines: (string | null)[] = [
    "Record type: booking",
    line("Booking number", b.booking_number),
    line("Customer name", i.booking.customers?.name),
    line("Trip", b.title, true),
    line("Destination", b.destination),
    line("Travel dates", b.travel_start ? `${b.travel_start} to ${b.travel_end ?? "?"}` : null),
    line("Travellers", `${b.adults} adult(s), ${b.children} child(ren)`),
    line("Status", b.status),
    line("Cancellation reason", b.cancellation_reason, true),
  ];
  if (i.canSeeMoney) {
    lines.push(
      line("Total", money(b.total_amount, b.currency)),
      line("Paid", money(b.paid_amount, b.currency)),
      line("Balance", money(b.balance_amount, b.currency)),
    );
    for (const s of i.schedule.slice(0, 12))
      lines.push(
        `Instalment: ${free(s.label, 80)} due ${s.due_date}, ${money(s.amount, b.currency)}, ${s.schedule_status}`,
      );
  }
  for (const it of i.items.slice(0, 40))
    lines.push(
      `Service: ${clip(it.type, 20)} - ${free(it.description, 160)}${it.service_date ? ` on ${it.service_date}` : ""} [${it.confirmation_status}]`,
    );
  for (const t of i.tasks.slice(0, 10))
    lines.push(`Open task: ${free(t.title, 120)}${t.due_date ? ` (due ${t.due_date})` : ""}`);
  return wrapCrmData(lines);
}

export type LeadContextInput = {
  lead: Record<string, unknown> & { customers?: { name?: string } | null };
  activities: Record<string, unknown>[];
  notes: Record<string, unknown>[];
};

export function leadContext(i: LeadContextInput): string {
  const l = i.lead;
  const lines: (string | null)[] = [
    "Record type: lead (enquiry)",
    line("Title", l.title, true),
    line("Customer name", i.lead.customers?.name),
    line("Destination", l.destination),
    line("Dates", l.departure_date ? `${l.departure_date} to ${l.return_date ?? "?"}` : null),
    line("Travellers", `${l.adults} adult(s), ${l.children} child(ren), ${l.infants} infant(s)`),
    line("Budget", l.budget ? money(l.budget, l.currency) : null),
    line("Trip type", l.trip_type),
    line("Hotel category", l.hotel_category),
    line(
      "Needs",
      [
        l.transport_required && "transport",
        l.visa_required && "visa",
        l.insurance_required && "insurance",
      ]
        .filter(Boolean)
        .join(", "),
    ),
    line("Status", l.status),
    line("Priority", l.priority),
    line("Notes", l.notes, true),
  ];
  for (const a of i.activities.slice(0, 8))
    lines.push(
      `Activity: ${clip(a.type, 20)} - ${free(a.summary, 200)} (${String(a.created_at).slice(0, 10)})`,
    );
  for (const n of i.notes.slice(0, 5)) lines.push(`Note: ${free(n.body, 300)}`);
  return wrapCrmData(lines);
}

/** The plain-text brief used to ask the model for an itinerary suggestion. No names or contact details. */
export function itineraryBrief(lead: Record<string, unknown>, extra: string | undefined): string {
  const parts = [
    line("Destination", lead.destination),
    line("Trip type", lead.trip_type),
    line("Departure", lead.departure_date),
    line("Return", lead.return_date),
    line("Adults", lead.adults),
    line("Children", lead.children),
    line("Hotel category", lead.hotel_category),
    line("Budget", lead.budget ? money(lead.budget, lead.currency) : null),
    line("Customer notes", lead.notes, true),
    extra ? `Agent instructions: ${free(extra, 600)}` : null,
  ];
  return parts.filter(Boolean).join("\n");
}
