import "server-only";
import { createClient } from "@/lib/supabase/server";
import { buildTimeline, type TimelineSources } from "@/lib/crm/timeline";

/**
 * Everything the lead page's History tabs show. Every query runs under the signed-in user's session, so Postgres RLS
 * limits it to their agency and permissions; the `can` checks below only skip queries the user could not read anyway
 * (so a Viewer without payments access gets an empty list instead of an error).
 */

export type EnquiryRow = {
  id: string;
  enquiry_number: string;
  enquiry_date: string;
  requirements: string | null;
  destination: string | null;
  departure_date: string | null;
  return_date: string | null;
  travellers: number | null;
  lead_source_id: string | null;
  assigned_user_id: string | null;
  status: string;
  lost_reason: string | null;
  created_at: string;
  created_by: string | null;
};

export type LeadQuotation = {
  id: string;
  quotation_number: string;
  title: string;
  status: string;
  currency: string;
  version: number;
  enquiry_id: string | null;
  created_at: string;
  sent_at: string | null;
  approved_at: string | null;
  created_by: string | null;
};

export type LeadItinerary = {
  id: string;
  title: string;
  destination: string | null;
  status: string;
  version: number;
  enquiry_id: string | null;
  start_date: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type LeadBooking = {
  id: string;
  booking_number: string;
  title: string;
  destination: string | null;
  travel_start: string | null;
  travel_end: string | null;
  adults: number;
  children: number;
  status: string;
  currency: string;
  total_amount: number;
  paid_amount: number;
  created_at: string;
  created_by: string | null;
};

export type LeadTask = TimelineSources["tasks"][number] & { due_date: string | null };

export type LeadHistory = {
  enquiries: EnquiryRow[];
  quotations: LeadQuotation[];
  itineraries: LeadItinerary[];
  bookings: LeadBooking[];
  tasks: LeadTask[];
  sources: TimelineSources;
};

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

export async function getLeadHistory(
  lead: { id: string; created_at: string; created_by?: string | null },
  can: (permission: string) => boolean,
): Promise<LeadHistory> {
  const supabase = await createClient();
  const one = async <T>(run: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> => {
    const { data, error } = await run;
    if (error) throw error;
    return (data ?? []) as T[];
  };

  const [activities, notes, enquiries, tasks, quotations, itineraries, bookings] =
    await Promise.all([
      one<TimelineSources["activities"][number]>(
        supabase
          .from("lead_activities")
          .select("id, type, summary, created_at, created_by")
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: false })
          .limit(200),
      ),
      one<TimelineSources["notes"][number]>(
        supabase
          .from("lead_notes")
          .select("id, body, created_at, created_by")
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: false })
          .limit(200),
      ),
      can("leads.view")
        ? one<EnquiryRow>(
            supabase
              .from("enquiries")
              .select("*")
              .eq("lead_id", lead.id)
              .order("enquiry_date", { ascending: false })
              .order("created_at", { ascending: false }),
          )
        : [],
      can("tasks.view")
        ? one<LeadTask>(
            supabase
              .from("tasks")
              .select(
                "id, kind, title, status, due_date, created_at, completed_at, created_by, assigned_to",
              )
              .eq("related_type", "LEAD")
              .eq("related_id", lead.id)
              .order("created_at", { ascending: false })
              .limit(200),
          )
        : [],
      can("quotes.view")
        ? one<LeadQuotation>(
            supabase
              .from("quotations")
              .select(
                "id, quotation_number, title, status, currency, version, enquiry_id, created_at, sent_at, approved_at, created_by",
              )
              .eq("lead_id", lead.id)
              .order("created_at", { ascending: false }),
          )
        : [],
      can("itineraries.view")
        ? one<LeadItinerary>(
            supabase
              .from("itineraries")
              .select(
                "id, title, destination, status, version, enquiry_id, start_date, created_at, updated_at, created_by",
              )
              .eq("lead_id", lead.id)
              .eq("is_template", false)
              .order("created_at", { ascending: false }),
          )
        : [],
      can("bookings.view")
        ? one<LeadBooking>(
            supabase
              .from("bookings")
              .select(
                "id, booking_number, title, destination, travel_start, travel_end, adults, children, status, currency, total_amount, paid_amount, created_at, created_by",
              )
              .eq("lead_id", lead.id)
              .order("created_at", { ascending: false }),
          )
        : [],
    ]);

  const bookingIds = ids(bookings);
  const [bookingHistory, payments, documents] = bookingIds.length
    ? await Promise.all([
        one<TimelineSources["bookingHistory"][number]>(
          supabase
            .from("booking_status_history")
            .select("id, booking_id, to_status, reason, created_at, changed_by")
            .in("booking_id", bookingIds)
            .order("created_at", { ascending: false })
            .limit(200),
        ),
        can("payments.view")
          ? one<TimelineSources["payments"][number]>(
              supabase
                .from("payments")
                .select(
                  "id, booking_id, amount, currency, method, status, paid_at, created_at, created_by",
                )
                .in("booking_id", bookingIds)
                .order("created_at", { ascending: false })
                .limit(200),
            )
          : [],
        can("documents.view")
          ? one<TimelineSources["documents"][number]>(
              supabase
                .from("documents")
                .select("id, name, category, created_at, uploaded_by, booking_id")
                .in("booking_id", bookingIds)
                .eq("is_sensitive", false)
                .order("created_at", { ascending: false })
                .limit(200),
            )
          : [],
      ])
    : [[], [], []];

  return {
    enquiries,
    quotations,
    itineraries,
    bookings,
    tasks,
    sources: {
      lead,
      activities,
      notes,
      enquiries: enquiries.map((e) => ({
        id: e.id,
        enquiry_number: e.enquiry_number,
        destination: e.destination,
        created_at: e.created_at,
        created_by: e.created_by,
      })),
      tasks,
      itineraries,
      quotations,
      bookings,
      bookingHistory,
      payments,
      documents,
    },
  };
}

export { buildTimeline };
