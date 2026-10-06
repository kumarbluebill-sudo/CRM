import "server-only";
import { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE } from "@/lib/crm/constants";

export type PaymentRow = {
  id: string;
  booking_id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  reference: string | null;
  receipt_number: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  bookings?: { booking_number: string; title: string } | null;
};

export type ScheduleRow = {
  id: string;
  booking_id: string;
  booking_number: string;
  label: string;
  due_date: string;
  amount: number;
  covered: number;
  schedule_status: "PAID" | "OVERDUE" | "PARTIAL" | "UPCOMING";
  currency: string;
};

export type InvoiceRow = {
  id: string;
  invoice_number: string;
  booking_id: string;
  status: string;
  issue_date: string;
  due_date: string | null;
  currency: string;
  total_amount: number;
  void_reason: string | null;
  bookings?: { booking_number: string } | null;
};

export async function listBookingPayments(bookingId: string) {
  const supabase = await createClient();
  const [payments, schedule, invoices] = await Promise.all([
    supabase
      .from("payments")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("payment_schedule_status")
      .select("*")
      .eq("booking_id", bookingId)
      .order("due_date"),
    supabase
      .from("invoices")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false }),
  ]);
  for (const r of [payments, schedule, invoices]) if (r.error) throw r.error;
  return {
    payments: (payments.data ?? []) as unknown as PaymentRow[],
    schedule: (schedule.data ?? []) as unknown as ScheduleRow[],
    invoices: (invoices.data ?? []) as unknown as InvoiceRow[],
  };
}

export async function listPayments(params: {
  status?: string;
  page?: number;
  receiptsOnly?: boolean;
}) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  let q = supabase
    .from("payments")
    .select("*, bookings ( booking_number, title )", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (params.receiptsOnly) q = q.eq("status", "CAPTURED");
  else if (params.status) q = q.eq("status", params.status);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as PaymentRow[], total: count ?? 0, page };
}

export async function listInvoices(page = 1) {
  const supabase = await createClient();
  const p = Math.max(1, page);
  const { data, count, error } = await supabase
    .from("invoices")
    .select("*, bookings ( booking_number )", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((p - 1) * PAGE_SIZE, p * PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: (data ?? []) as unknown as InvoiceRow[], total: count ?? 0, page: p };
}

/** Unpaid instalments that are overdue or due within `days`, soonest first. */
export async function listDueSchedules(days = 7) {
  const supabase = await createClient();
  const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("payment_schedule_status")
    .select("*")
    .neq("schedule_status", "PAID")
    .not("booking_status", "in", "(CANCELLED,COMPLETED,DRAFT)")
    .lte("due_date", until)
    .order("due_date")
    .limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as ScheduleRow[];
}
