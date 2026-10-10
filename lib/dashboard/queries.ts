import { createClient } from "@/lib/supabase/server";
import { isoDay, parseRange } from "@/lib/reports/range";
import { todayInZone } from "@/lib/datetime/format";

export type DashboardRange = "today" | "7d" | "30d" | "month" | "custom";
export const RANGE_LABELS: Record<Exclude<DashboardRange, "custom">, string> = {
  today: "Today",
  "7d": "7 Days",
  "30d": "30 Days",
  month: "This Month",
};

const DAY = 86_400_000;

/** Resolves ?range= (and ?from=&to= for custom) to concrete dates. Anything invalid falls back to 30 days. */
export function resolveRange(
  range?: string,
  from?: string,
  to?: string,
  now = new Date(),
  timeZone?: string,
): { key: DashboardRange; from: string; to: string } {
  // "today" is the calendar day in the agency time zone; every other range is counted back from it
  const today = timeZone ? todayInZone(timeZone, now) : isoDay(now);
  if (timeZone) now = new Date(`${today}T12:00:00Z`);
  switch (range) {
    case "today":
      return { key: "today", from: today, to: today };
    case "7d":
      return { key: "7d", from: isoDay(new Date(now.getTime() - 6 * DAY)), to: today };
    case "month":
      return {
        key: "month",
        from: isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
        to: today,
      };
    case "custom": {
      const r = parseRange(from, to, now);
      return { key: "custom", ...r };
    }
    default:
      return { key: "30d", from: isoDay(new Date(now.getTime() - 29 * DAY)), to: today };
  }
}

export type Dashboard = {
  currency: string;
  kpi: Partial<
    Record<
      | "enquiries"
      | "confirmedBookings"
      | "upcomingDepartures"
      | "revenue"
      | "collected"
      | "outstanding"
      | "pendingVisa"
      | "profit"
      | "profitBookings"
      | "bookingsInRange"
      | "otherCurrencyBookings",
      number
    >
  >;
  previous: Partial<Record<"enquiries" | "confirmedBookings" | "revenue" | "collected", number>>;
  funnel?: { enquiries: number; quotations: number; approved: number; bookings: number };
  bookingStatus?: Record<string, number>;
  revenueByMonth?: { month: string; value: number }[];
  byDestination?: { destination: string; value: number; count: number }[];
  collectionByMonth?: { month: string; collected: number; outstanding: number }[];
  staff?: { userId: string | null; bookings: number; value: number }[];
  departures?: {
    id: string;
    title: string;
    destination: string | null;
    date: string;
    status: string;
  }[];
  pendingPayments?: {
    bookingId: string;
    number: string;
    label: string;
    due: string;
    amount: number;
    currency: string;
    status: string;
  }[];
  visaDocs?: { applicationId: string; number: string; missing: number }[];
  followups?: {
    id: string;
    title: string;
    due: string;
    relatedType: string | null;
    relatedId: string | null;
  }[];
  overdueTasks?: {
    id: string;
    title: string;
    due: string;
    priority: string;
    relatedType: string | null;
    relatedId: string | null;
  }[];
  recent?: { id: string; action: string; entity: string; userId: string | null; at: string }[];
};

export async function getDashboard(range: { from: string; to: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_summary", {
    p_from: range.from,
    p_to: range.to,
  });
  if (error) throw error;
  return data as Dashboard;
}
