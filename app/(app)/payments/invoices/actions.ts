"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { rateLimit } from "@/lib/rate-limit";
import { redirect, runAction } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { throwInvoicingError } from "@/lib/invoicing/errors";
import { creditNoteSchema, invoiceDraftSchema } from "@/lib/invoicing/schema";

async function guard(permission: Parameters<typeof requirePermission>[0], key: string, limit = 40) {
  const session = await requirePermission(permission);
  if (!(await rateLimit(`${key}:${session.userId}`, limit, 60_000)).allowed)
    throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
  return session;
}

const open = (id: string) => `/payments/invoices/${id}`;

/** Starts a draft from a booking, then opens it for editing. */
export async function createDraftInvoiceAction(bookingId: string): Promise<FormState> {
  if (!uuid.safeParse(bookingId).success) return { message: "Booking not found." };
  let id = "";
  const result = await runAction(async () => {
    await guard("payments.create", "invoice-draft", 20);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_draft_invoice", { p_booking: bookingId });
    throwInvoicingError(error, "create draft invoice");
    id = data as string;
    revalidatePath(`/bookings/${bookingId}`);
    revalidatePath("/payments/invoices");
  });
  if (result.message) return result;
  redirect(open(id));
}

/** The editor's JSON is validated here and again by the database, which does all of the arithmetic. */
export async function saveDraftInvoiceAction(id: string, payload: unknown): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Invoice not found." };
  const parsed = invoiceDraftSchema.safeParse(payload);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    return {
      message:
        Object.values(flat.fieldErrors).flat()[0] ??
        flat.formErrors[0] ??
        "Check the invoice details.",
    };
  }
  return runAction(async () => {
    await guard("payments.create", "invoice-save");
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_draft_invoice", { p_id: id, p_data: parsed.data });
    throwInvoicingError(error, "save draft invoice");
    revalidatePath(open(id));
    return { ok: true, message: "Draft saved. Totals were recalculated." };
  });
}

export async function issueInvoiceFromDraftAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Invoice not found." };
  return runAction(async () => {
    await guard("payments.create", "invoice-issue", 20);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("issue_gst_invoice", { p_id: id });
    throwInvoicingError(error, "issue invoice");
    revalidatePath(open(id));
    revalidatePath("/payments/invoices");
    return { ok: true, message: `Invoice ${data as string} issued.` };
  });
}

export async function cancelDraftInvoiceAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Invoice not found." };
  return runAction(async () => {
    await guard("payments.create", "invoice-cancel");
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_draft_invoice", { p_id: id });
    throwInvoicingError(error, "cancel draft invoice");
    revalidatePath(open(id));
    revalidatePath("/payments/invoices");
    return { ok: true, message: "Draft cancelled." };
  });
}

export async function createCreditNoteAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Invoice not found." };
  const parsed = creditNoteSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  return runAction(async () => {
    await guard("invoicing.manage", "credit-note", 10);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_credit_note", {
      p_invoice: id,
      p_reason: parsed.data.reason,
      p_lines: null,
    });
    throwInvoicingError(error, "create credit note");
    revalidatePath(open(id));
    revalidatePath("/payments/invoices");
    return { ok: true, message: `Credit note ${data as string} issued for the full invoice.` };
  });
}
