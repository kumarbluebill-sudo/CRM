/**
 * Builds the "Activity timeline" of a lead from rows that really exist (activities, enquiries, follow-ups, itineraries,
 * quotations, bookings, payments, documents). Nothing is invented: a lead with no history yields an empty list.
 * Pure function, so it is unit-tested without a database.
 */

export type TimelineType =
  | "LEAD"
  | "ENQUIRY"
  | "CONTACT"
  | "FOLLOW_UP"
  | "ITINERARY"
  | "QUOTATION"
  | "BOOKING"
  | "PAYMENT"
  | "DOCUMENT"
  | "NOTE";

export type TimelineEvent = {
  key: string;
  at: string;
  type: TimelineType;
  title: string;
  detail?: string | null;
  by?: string | null;
  href?: string;
};

export type TimelineSources = {
  lead: { id: string; created_at: string; created_by?: string | null };
  activities: {
    id: string;
    type: string;
    summary: string;
    created_at: string;
    created_by?: string | null;
  }[];
  notes: { id: string; body: string; created_at: string; created_by?: string | null }[];
  enquiries: {
    id: string;
    enquiry_number: string;
    destination: string | null;
    created_at: string;
    created_by?: string | null;
  }[];
  tasks: {
    id: string;
    kind: string;
    title: string;
    created_at: string;
    completed_at: string | null;
    status: string;
    created_by?: string | null;
    assigned_to?: string | null;
  }[];
  itineraries: {
    id: string;
    title: string;
    version: number;
    created_at: string;
    updated_at: string;
    created_by?: string | null;
  }[];
  quotations: {
    id: string;
    quotation_number: string;
    title: string;
    version: number;
    created_at: string;
    sent_at: string | null;
    approved_at: string | null;
    created_by?: string | null;
  }[];
  bookings: {
    id: string;
    booking_number: string;
    title: string;
    created_at: string;
    created_by?: string | null;
  }[];
  bookingHistory: {
    id: string;
    booking_id: string;
    to_status: string;
    reason: string | null;
    created_at: string;
    changed_by?: string | null;
  }[];
  payments: {
    id: string;
    booking_id: string;
    amount: number;
    currency: string;
    method: string;
    status: string;
    paid_at: string | null;
    created_at: string;
    created_by?: string | null;
  }[];
  documents: {
    id: string;
    name: string;
    category: string;
    created_at: string;
    uploaded_by?: string | null;
    booking_id: string | null;
  }[];
};

const ACTIVITY_TITLES: Record<string, { title: string; type: TimelineType }> = {
  CREATED: { title: "Lead created", type: "LEAD" },
  STATUS_CHANGE: { title: "Lead updated", type: "LEAD" },
  ASSIGNED: { title: "Lead updated", type: "LEAD" },
  CALL: { title: "Call recorded", type: "CONTACT" },
  MEETING: { title: "Meeting recorded", type: "CONTACT" },
  EMAIL: { title: "Email recorded", type: "CONTACT" },
  WHATSAPP: { title: "WhatsApp recorded", type: "CONTACT" },
  OTHER: { title: "Activity recorded", type: "LEAD" },
};

const pretty = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const money = (n: number, c: string) =>
  `${c} ${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function buildTimeline(
  s: TimelineSources,
  nameOf: (userId: string | null | undefined) => string | null,
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const push = (e: Omit<TimelineEvent, "by"> & { userId?: string | null }) => {
    const { userId, ...rest } = e;
    out.push({ ...rest, by: nameOf(userId) });
  };

  // the creation event normally exists as an activity; fall back to the lead's own created_at only when it does not
  if (!s.activities.some((a) => a.type === "CREATED")) {
    push({
      key: `lead:${s.lead.id}`,
      at: s.lead.created_at,
      type: "LEAD",
      title: "Lead created",
      userId: s.lead.created_by,
    });
  }
  for (const a of s.activities) {
    const meta = ACTIVITY_TITLES[a.type] ?? ACTIVITY_TITLES.OTHER;
    push({
      key: `activity:${a.id}`,
      at: a.created_at,
      type: meta.type,
      title: meta.title,
      detail: a.summary,
      userId: a.created_by,
    });
  }
  for (const n of s.notes) {
    push({
      key: `note:${n.id}`,
      at: n.created_at,
      type: "NOTE",
      title: "Note added",
      detail: n.body.slice(0, 200),
      userId: n.created_by,
    });
  }
  for (const e of s.enquiries) {
    push({
      key: `enquiry:${e.id}`,
      at: e.created_at,
      type: "ENQUIRY",
      title: "Enquiry added",
      detail: [e.enquiry_number, e.destination].filter(Boolean).join(" · "),
      userId: e.created_by,
    });
  }
  for (const t of s.tasks) {
    const what = t.kind === "FOLLOWUP" ? "Follow-up" : "Task";
    push({
      key: `task:${t.id}:new`,
      at: t.created_at,
      type: "FOLLOW_UP",
      title: `${what} scheduled`,
      detail: t.title,
      userId: t.created_by,
    });
    if (t.completed_at && t.status === "COMPLETED") {
      push({
        key: `task:${t.id}:done`,
        at: t.completed_at,
        type: "FOLLOW_UP",
        title: `${what} completed`,
        detail: t.title,
        userId: t.assigned_to ?? t.created_by,
      });
    }
  }
  for (const i of s.itineraries) {
    push({
      key: `itinerary:${i.id}:new`,
      at: i.created_at,
      type: "ITINERARY",
      title: "Itinerary created",
      detail: i.title,
      userId: i.created_by,
      href: `/itineraries/${i.id}`,
    });
    if (i.version > 1) {
      push({
        key: `itinerary:${i.id}:rev`,
        at: i.updated_at,
        type: "ITINERARY",
        title: "Itinerary revised",
        detail: `${i.title} (version ${i.version})`,
        userId: i.created_by,
        href: `/itineraries/${i.id}`,
      });
    }
  }
  for (const q of s.quotations) {
    const label = `${q.quotation_number} · ${q.title}`;
    push({
      key: `quote:${q.id}:new`,
      at: q.created_at,
      type: "QUOTATION",
      title: "Quotation prepared",
      detail: label,
      userId: q.created_by,
      href: `/quotations/${q.id}`,
    });
    if (q.sent_at)
      push({
        key: `quote:${q.id}:sent`,
        at: q.sent_at,
        type: "QUOTATION",
        title: "Quotation sent",
        detail: label,
        userId: q.created_by,
        href: `/quotations/${q.id}`,
      });
    if (q.approved_at)
      push({
        key: `quote:${q.id}:ok`,
        at: q.approved_at,
        type: "QUOTATION",
        title: "Quotation approved",
        detail: label,
        userId: null,
        href: `/quotations/${q.id}`,
      });
  }
  const bookingNo = new Map(s.bookings.map((b) => [b.id, b.booking_number]));
  for (const b of s.bookings) {
    push({
      key: `booking:${b.id}`,
      at: b.created_at,
      type: "BOOKING",
      title: "Booking created",
      detail: `${b.booking_number} · ${b.title}`,
      userId: b.created_by,
      href: `/bookings/${b.id}`,
    });
  }
  for (const h of s.bookingHistory) {
    push({
      key: `bookinghist:${h.id}`,
      at: h.created_at,
      type: "BOOKING",
      title: "Booking updated",
      detail: `${bookingNo.get(h.booking_id) ?? "Booking"} → ${pretty(h.to_status)}${h.reason ? ` (${h.reason})` : ""}`,
      userId: h.changed_by,
      href: `/bookings/${h.booking_id}`,
    });
  }
  for (const p of s.payments) {
    if (p.status !== "CAPTURED") continue;
    push({
      key: `payment:${p.id}`,
      at: p.paid_at ?? p.created_at,
      type: "PAYMENT",
      title: "Payment recorded",
      detail:
        `${money(p.amount, p.currency)} · ${pretty(p.method)} · ${bookingNo.get(p.booking_id) ?? ""}`.replace(
          / · $/,
          "",
        ),
      userId: p.created_by,
      href: `/bookings/${p.booking_id}`,
    });
  }
  for (const d of s.documents) {
    push({
      key: `document:${d.id}`,
      at: d.created_at,
      type: "DOCUMENT",
      title: "Document uploaded",
      detail: `${d.name} (${pretty(d.category)})`,
      userId: d.uploaded_by,
      href: d.booking_id ? `/bookings/${d.booking_id}` : undefined,
    });
  }

  // newest first; the key makes the order stable and removes accidental duplicates
  const seen = new Set<string>();
  return out
    .filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)))
    .sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime() || a.key.localeCompare(b.key),
    );
}
