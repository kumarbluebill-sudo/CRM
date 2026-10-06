import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { toCsv } from "@/lib/reports/csv";
import { parseRange } from "@/lib/reports/range";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_ROWS = 5000;
const json = (status: number, error: string) => NextResponse.json({ error }, { status });

type Spec = {
  permission: "bookings.view" | "payments.view" | "leads.view";
  table: string;
  select: string;
  dateColumn: string;
  columns: { key: string; header: string }[];
  map: (r: Record<string, unknown>) => Record<string, unknown>;
};

/** Deliberately limited columns: no supplier costs, profit, passport data or contact details. */
const SPECS: Record<string, Spec> = {
  bookings: {
    permission: "bookings.view",
    table: "bookings",
    select:
      "booking_number, title, destination, travel_start, travel_end, status, currency, total_amount, paid_amount, balance_amount, created_at, customers ( name )",
    dateColumn: "created_at",
    columns: [
      { key: "booking_number", header: "Booking" },
      { key: "customer", header: "Customer" },
      { key: "title", header: "Trip" },
      { key: "destination", header: "Destination" },
      { key: "travel_start", header: "Departure" },
      { key: "travel_end", header: "Return" },
      { key: "status", header: "Status" },
      { key: "currency", header: "Currency" },
      { key: "total_amount", header: "Total" },
      { key: "paid_amount", header: "Paid" },
      { key: "balance_amount", header: "Balance" },
      { key: "created_at", header: "Created" },
    ],
    map: (r) => ({ ...r, customer: (r.customers as { name?: string } | null)?.name ?? "" }),
  },
  payments: {
    permission: "payments.view",
    table: "payments",
    select:
      "receipt_number, amount, currency, method, status, reference, paid_at, created_at, bookings ( booking_number )",
    dateColumn: "created_at",
    columns: [
      { key: "receipt_number", header: "Receipt" },
      { key: "booking", header: "Booking" },
      { key: "amount", header: "Amount" },
      { key: "currency", header: "Currency" },
      { key: "method", header: "Method" },
      { key: "status", header: "Status" },
      { key: "reference", header: "Reference" },
      { key: "paid_at", header: "Paid at" },
    ],
    map: (r) => ({
      ...r,
      booking: (r.bookings as { booking_number?: string } | null)?.booking_number ?? "",
    }),
  },
  leads: {
    permission: "leads.view",
    table: "leads",
    select:
      "title, destination, departure_date, adults, children, budget, currency, trip_type, status, priority, created_at, customers ( name )",
    dateColumn: "created_at",
    columns: [
      { key: "title", header: "Lead" },
      { key: "customer", header: "Customer" },
      { key: "destination", header: "Destination" },
      { key: "departure_date", header: "Departure" },
      { key: "adults", header: "Adults" },
      { key: "children", header: "Children" },
      { key: "budget", header: "Budget" },
      { key: "currency", header: "Currency" },
      { key: "trip_type", header: "Trip type" },
      { key: "status", header: "Status" },
      { key: "priority", header: "Priority" },
      { key: "created_at", header: "Created" },
    ],
    map: (r) => ({ ...r, customer: (r.customers as { name?: string } | null)?.name ?? "" }),
  },
};

export async function GET(req: NextRequest) {
  const session = await getSessionContext();
  if (!session) return json(401, "Please sign in.");
  if (!session.organization || !session.permissions.has("reports.view"))
    return json(403, "Forbidden.");

  const type = req.nextUrl.searchParams.get("type") ?? "";
  const spec = Object.hasOwn(SPECS, type) ? SPECS[type] : undefined;
  if (!spec) return json(400, "Unknown export.");
  if (!session.permissions.has(spec.permission)) return json(403, "Forbidden.");
  if (!(await rateLimit(`report-export:${session.userId}`, 10, 60_000)).allowed)
    return json(429, "Too many exports. Please wait a moment.");

  const range = parseRange(
    req.nextUrl.searchParams.get("from") ?? undefined,
    req.nextUrl.searchParams.get("to") ?? undefined,
  );
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from(spec.table)
      .select(spec.select)
      .gte(spec.dateColumn, `${range.from}T00:00:00Z`)
      .lte(spec.dateColumn, `${range.to}T23:59:59.999Z`)
      .order(spec.dateColumn, { ascending: false })
      .limit(MAX_ROWS);
    if (error) throw error;
    const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(spec.map);
    await audit(supabase, "EXPORT", `report_${type}`, null, { rows: rows.length, ...range });
    return new NextResponse(toCsv(spec.columns, rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${type}-${range.from}-to-${range.to}.csv"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("report export failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(500, "Could not create the export.");
  }
}
