import { createClient } from "@/lib/supabase/server";

export type TaxProfile = {
  gst_registered: boolean;
  gstin: string | null;
  legal_name: string | null;
  trade_name: string | null;
  address: string | null;
  state_code: string | null;
  pan: string | null;
  invoice_prefix: string;
  prices_include_tax: boolean;
  round_off: boolean;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  upi_id: string | null;
  terms: string | null;
  signature_data: string | null;
};

export async function getTaxProfile() {
  const supabase = await createClient();
  const { data } = await supabase.from("organization_tax_profile").select("*").maybeSingle();
  return (data as TaxProfile | null) ?? null;
}

export type TaxCode = {
  id: string;
  name: string;
  sac_code: string | null;
  rate: number;
  treatment: "TAXABLE" | "EXEMPT" | "ZERO_RATED" | "NIL_RATED";
  active: boolean;
  verified_at: string | null;
};

export async function listTaxCodes() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("tax_codes").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as TaxCode[];
}

export type InvoiceFull = {
  id: string;
  invoice_number: string | null;
  booking_id: string;
  customer_id: string;
  status: "DRAFT" | "ISSUED" | "VOID" | "CANCELLED" | "CREDITED";
  doc_type: "TAX_INVOICE" | "INVOICE" | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  bill_to: { name: string; email?: string | null; phone?: string | null; address?: string | null };
  customer_gstin: string | null;
  place_of_supply: string | null;
  supply_type: "INTRA" | "INTER" | "NONE";
  price_includes_tax: boolean;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax_total: number;
  rounding: number;
  total_amount: number;
  notes: string | null;
  terms: string | null;
  void_reason: string | null;
  tax_snapshot: Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  issued_at: string | null;
  bookings?: {
    booking_number: string;
    title: string;
    paid_amount: number;
    total_amount: number;
  } | null;
};

export type InvoiceLine = {
  id: string;
  position: number;
  description: string;
  tax_code_id: string | null;
  sac_code: string | null;
  rate: number;
  quantity: number;
  unit_price: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  line_total: number;
};

export type CreditNoteRow = {
  id: string;
  credit_note_number: string;
  issue_date: string;
  reason: string;
  subtotal: number;
  tax_total: number;
  total_amount: number;
};

export async function getInvoiceFull(id: string) {
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("invoices")
    .select("*, bookings ( booking_number, title, paid_amount, total_amount )")
    .eq("id", id)
    .maybeSingle();
  if (!inv) return null;
  const [lines, notes] = await Promise.all([
    supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("position"),
    supabase
      .from("credit_notes")
      .select("id, credit_note_number, issue_date, reason, subtotal, tax_total, total_amount")
      .eq("invoice_id", id)
      .order("created_at"),
  ]);
  return {
    invoice: inv as unknown as InvoiceFull,
    lines: (lines.data ?? []) as unknown as InvoiceLine[],
    creditNotes: (notes.data ?? []) as unknown as CreditNoteRow[],
  };
}

export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

/** Paid / balance for an invoice come from the booking's captured payments, so they can never drift from the ledger. */
export function invoicePaymentStatus(
  total: number,
  paid: number,
): { status: PaymentStatus; paid: number; balance: number } {
  const p = Math.min(Math.max(paid, 0), total);
  const balance = Math.round((total - p) * 100) / 100;
  return { status: balance <= 0 ? "PAID" : p > 0 ? "PARTIAL" : "UNPAID", paid: p, balance };
}
