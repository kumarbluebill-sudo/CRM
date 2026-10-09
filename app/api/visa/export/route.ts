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
  permission: string;
  table: string;
  select: string;
  dateColumn: string;
  columns: { key: string; header: string }[];
  map: (r: Record<string, unknown>) => Record<string, unknown>;
};

const name = (v: unknown, key: string) => (v as Record<string, string> | null)?.[key] ?? "";

/** Deliberately limited columns: no passport data, no contact details, no supplier cost unless the table itself is cost-gated. */
const SPECS: Record<string, Spec> = {
  applications: {
    permission: "visa.report.view",
    table: "visa_applications",
    select:
      "application_number, visa_type, nationality, status, priority, travel_date, express, total_price, price_currency, expected_completion, submitted_at, created_at, customers ( name ), visa_countries ( name )",
    dateColumn: "created_at",
    columns: [
      { key: "application_number", header: "Application" },
      { key: "customer", header: "Customer" },
      { key: "country", header: "Country" },
      { key: "visa_type", header: "Visa type" },
      { key: "nationality", header: "Nationality" },
      { key: "status", header: "Status" },
      { key: "priority", header: "Priority" },
      { key: "travel_date", header: "Travel date" },
      { key: "express", header: "Express" },
      { key: "price_currency", header: "Currency" },
      { key: "total_price", header: "Total" },
      { key: "expected_completion", header: "Expected completion" },
      { key: "submitted_at", header: "Submitted" },
      { key: "created_at", header: "Created" },
    ],
    map: (r) => ({
      ...r,
      customer: name(r.customers, "name"),
      country: name(r.visa_countries, "name"),
    }),
  },
  enquiries: {
    permission: "visa.report.view",
    table: "visa_enquiries",
    select:
      "enquiry_number, nationality, travel_date, travellers, source, priority, status, follow_up_date, created_at, customers ( name ), visa_countries ( name )",
    dateColumn: "created_at",
    columns: [
      { key: "enquiry_number", header: "Enquiry" },
      { key: "customer", header: "Customer" },
      { key: "country", header: "Country" },
      { key: "nationality", header: "Nationality" },
      { key: "travel_date", header: "Travel date" },
      { key: "travellers", header: "Travellers" },
      { key: "source", header: "Source" },
      { key: "priority", header: "Priority" },
      { key: "status", header: "Status" },
      { key: "follow_up_date", header: "Follow-up" },
      { key: "created_at", header: "Created" },
    ],
    map: (r) => ({
      ...r,
      customer: name(r.customers, "name"),
      country: name(r.visa_countries, "name"),
    }),
  },
  suppliers: {
    permission: "visa.supplier.view",
    table: "visa_supplier_submissions",
    select:
      "reference, submitted_on, expected_completion, actual_completion, cost, created_at, suppliers ( company_name ), visa_applications ( application_number )",
    dateColumn: "created_at",
    columns: [
      { key: "application", header: "Application" },
      { key: "supplier", header: "Supplier" },
      { key: "reference", header: "Reference" },
      { key: "submitted_on", header: "Submitted" },
      { key: "expected_completion", header: "Expected" },
      { key: "actual_completion", header: "Completed" },
      { key: "cost", header: "Cost" },
    ],
    map: (r) => ({
      ...r,
      application: name(r.visa_applications, "application_number"),
      supplier: name(r.suppliers, "company_name"),
    }),
  },
};

export async function GET(req: NextRequest) {
  const session = await getSessionContext();
  if (!session) return json(401, "Please sign in.");
  if (!session.organization || !session.permissions.has("visa.report.view"))
    return json(403, "Forbidden.");

  const type = req.nextUrl.searchParams.get("type") ?? "";
  const spec = Object.hasOwn(SPECS, type) ? SPECS[type] : undefined;
  if (!spec) return json(400, "Unknown export.");
  if (!(session.permissions as ReadonlySet<string>).has(spec.permission))
    return json(403, "Forbidden.");
  if (!(await rateLimit(`visa-export:${session.userId}`, 10, 60_000)).allowed)
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
    await audit(supabase, "EXPORT", `visa_report_${type}`, null, { rows: rows.length, ...range });
    return new NextResponse(toCsv(spec.columns, rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="visa-${type}-${range.from}-to-${range.to}.csv"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("visa export failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(500, "Could not create the export.");
  }
}
