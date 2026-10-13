import { createClient } from "@/lib/supabase/server";
import { getBranding } from "@/lib/quotation/queries";
import {
  getTaxProfile,
  listTaxCodes,
  invoicePaymentStatus,
  type InvoiceFull,
  type InvoiceLine,
} from "@/lib/invoicing/queries";
import type { GstDocProps, GstLine, PartyBlock } from "@/lib/pdf/gst-pdf";
import { toInvoiceLayout, type InvoiceLayout } from "@/lib/invoicing/layouts";

const num = (v: unknown) => Number(v ?? 0);

/** tax code id -> TAXABLE / EXEMPT / ...: from the frozen snapshot once issued, else the live tax codes. */
async function treatmentsFor(inv: InvoiceFull): Promise<Map<string, string>> {
  const snapCodes = inv.tax_snapshot?.taxCodes as { id: string; treatment: string }[] | undefined;
  const codes = snapCodes ?? (inv.tax_snapshot ? [] : await listTaxCodes());
  return new Map(codes.map((c) => [c.id, c.treatment]));
}

const toLine = (l: InvoiceLine, treatments: Map<string, string>): GstLine => ({
  description: l.description,
  sac: l.sac_code,
  quantity: num(l.quantity),
  unitPrice: num(l.unit_price),
  rate: num(l.rate),
  treatment: l.tax_code_id ? (treatments.get(l.tax_code_id) ?? null) : null,
  discount: num(l.discount),
  taxable: num(l.taxable),
  cgst: num(l.cgst),
  sgst: num(l.sgst),
  igst: num(l.igst),
  total: num(l.line_total),
});

/** The supplier block: frozen in the snapshot for issued invoices, the live profile for drafts. */
async function supplierFor(
  inv: InvoiceFull,
): Promise<{ supplier: PartyBlock; bank: GstDocProps["bank"]; signature: string | null }> {
  const [branding, profile] = await Promise.all([getBranding(), getTaxProfile()]);
  const snap = inv.tax_snapshot;
  const base = {
    logo: branding?.logo_data ?? null,
    email: branding?.email ?? null,
    phone: branding?.phone ?? null,
  };
  if (snap) {
    return {
      supplier: {
        ...base,
        legalName: String(snap.legalName ?? ""),
        tradeName: snap.tradeName ?? null,
        address: snap.address ?? null,
        gstin: snap.registered ? (snap.gstin ?? null) : null,
        pan: snap.pan ?? null,
        stateCode: snap.stateCode ?? null,
      },
      bank: snap.bank ?? null,
      signature: profile?.signature_data ?? null,
    };
  }
  return {
    supplier: {
      ...base,
      legalName: profile?.legal_name ?? "Your agency",
      tradeName: profile?.trade_name ?? null,
      address: profile?.address ?? null,
      gstin: profile?.gst_registered ? profile.gstin : null,
      pan: profile?.pan ?? null,
      stateCode: profile?.state_code ?? null,
    },
    bank: profile
      ? {
          name: profile.bank_name,
          accountName: profile.bank_account_name,
          accountNo: profile.bank_account_no,
          ifsc: profile.bank_ifsc,
          upi: profile.upi_id,
        }
      : null,
    signature: profile?.signature_data ?? null,
  };
}

/** The layout a person asked for, else the agency default. Anything unrecognised falls back to the default. */
export async function resolveLayout(requested?: string | null): Promise<InvoiceLayout> {
  if (requested) return toInvoiceLayout(requested);
  return toInvoiceLayout((await getTaxProfile())?.invoice_layout);
}

export async function buildInvoicePdfProps(
  inv: InvoiceFull,
  lines: InvoiceLine[],
  layoutRequest?: string | null,
): Promise<GstDocProps> {
  const branding = await getBranding();
  const layout = await resolveLayout(layoutRequest);
  const [{ supplier, bank, signature }, treatments] = await Promise.all([
    supplierFor(inv),
    treatmentsFor(inv),
  ]);
  const registered = inv.tax_snapshot
    ? Boolean(inv.tax_snapshot.registered)
    : supplier.gstin != null;
  const pay = invoicePaymentStatus(num(inv.total_amount), num(inv.bookings?.paid_amount));
  const watermark =
    inv.status === "DRAFT"
      ? "DRAFT"
      : inv.status === "CANCELLED"
        ? "CANCELLED"
        : inv.status === "CREDITED"
          ? "CREDITED"
          : inv.status === "VOID"
            ? "VOID"
            : null;
  return {
    kind: inv.doc_type ?? (registered ? "TAX_INVOICE" : "INVOICE"),
    number: inv.invoice_number,
    date: inv.issue_date,
    dueDate: inv.due_date,
    watermark,
    primary: branding?.primary_color,
    layout,
    currency: inv.currency,
    supplier,
    billTo: {
      name: inv.bill_to.name,
      address: inv.bill_to.address,
      email: inv.bill_to.email,
      phone: inv.bill_to.phone,
      gstin: inv.customer_gstin,
    },
    placeOfSupply: inv.place_of_supply,
    supplyType: inv.supply_type,
    reference: inv.bookings?.booking_number ?? null,
    lines: lines.map((l) => toLine(l, treatments)),
    subtotal: num(inv.subtotal),
    cgst: num(inv.cgst),
    sgst: num(inv.sgst),
    igst: num(inv.igst),
    rounding: num(inv.rounding),
    total: num(inv.total_amount),
    pricesIncludeTax: inv.price_includes_tax,
    payment:
      inv.status === "ISSUED" || inv.status === "CREDITED"
        ? { paid: pay.paid, balance: pay.balance, status: pay.status }
        : null,
    bank,
    notes: inv.notes,
    terms: inv.terms,
    signature,
  };
}

export async function buildCreditNotePdfProps(
  creditNoteId: string,
  layoutRequest?: string | null,
): Promise<{ props: GstDocProps; number: string } | null> {
  const supabase = await createClient();
  const { data: cn } = await supabase
    .from("credit_notes")
    .select("*")
    .eq("id", creditNoteId)
    .maybeSingle();
  if (!cn) return null;
  const { data: invRow } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", cn.invoice_id as string)
    .maybeSingle();
  if (!invRow) return null;
  const inv = invRow as unknown as InvoiceFull;
  const [{ data: cl }, { data: il }, branding, { supplier, bank, signature }, treatments] =
    await Promise.all([
      supabase.from("credit_note_lines").select("*").eq("credit_note_id", creditNoteId),
      supabase.from("invoice_lines").select("*").eq("invoice_id", inv.id).order("position"),
      getBranding(),
      supplierFor(inv),
      treatmentsFor(inv),
    ]);
  const byId = new Map(((il ?? []) as unknown as InvoiceLine[]).map((l) => [l.id, l]));
  const lines: GstLine[] = ((cl ?? []) as Record<string, unknown>[]).flatMap((c) => {
    const l = byId.get(c.invoice_line_id as string);
    if (!l) return [];
    return [
      {
        description: l.description,
        sac: l.sac_code,
        quantity: num(c.quantity),
        unitPrice: num(l.unit_price),
        rate: num(l.rate),
        treatment: l.tax_code_id ? (treatments.get(l.tax_code_id) ?? null) : null,
        discount: 0,
        taxable: num(c.taxable),
        cgst: num(c.cgst),
        sgst: num(c.sgst),
        igst: num(c.igst),
        total: num(c.taxable) + num(c.cgst) + num(c.sgst) + num(c.igst),
      },
    ];
  });
  return {
    number: cn.credit_note_number as string,
    props: {
      kind: "CREDIT_NOTE",
      number: cn.credit_note_number as string,
      date: cn.issue_date as string,
      primary: branding?.primary_color,
      layout: await resolveLayout(layoutRequest),
      currency: inv.currency,
      supplier,
      billTo: {
        name: inv.bill_to.name,
        address: inv.bill_to.address,
        email: inv.bill_to.email,
        phone: inv.bill_to.phone,
        gstin: inv.customer_gstin,
      },
      placeOfSupply: inv.place_of_supply,
      supplyType: inv.supply_type,
      reference: inv.invoice_number,
      lines,
      subtotal: num(cn.subtotal),
      cgst: num(cn.cgst),
      sgst: num(cn.sgst),
      igst: num(cn.igst),
      rounding: num(cn.rounding),
      total: num(cn.total_amount),
      bank,
      reason: cn.reason as string,
      signature,
    },
  };
}
