"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env.server";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";
import { rateLimit } from "@/lib/rate-limit";
import { formObject, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { createRazorpayOrder, toMinorUnits } from "@/lib/payments/razorpay";
import {
  invoiceSchema,
  manualPaymentSchema,
  onlinePaymentSchema,
  scheduleSchema,
} from "@/lib/payments/schema";

type DbError = { code?: string; message: string } | null;

function throwPaymentError(error: DbError, context: string) {
  switch (error?.code) {
    case "P0002":
      throw new AppError("Booking, invoice or payment not found.", "NOT_FOUND", 404);
    case "P0009":
      throw new AppError("Please give a reason.", "REASON_REQUIRED", 400);
    case "P0010":
      throw new AppError(
        "Instalments can't add up to more than the booking total.",
        "TOO_MUCH",
        409,
      );
    case "P0011":
      throw new AppError(
        "This booking can't take payments in its current status.",
        "NOT_PAYABLE",
        409,
      );
    case "P0012":
      throw new AppError("That's more than the outstanding balance.", "OVERPAYMENT", 409);
    case "P0013":
      throw new AppError(
        "An invoice is already issued for this booking. Void it first.",
        "CONFLICT",
        409,
      );
    case "23505":
      throw new AppError("A payment with that reference already exists.", "DUPLICATE", 409);
  }
  throwIfDbError(error, context);
}

function refresh(bookingId: string) {
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/payments");
  revalidatePath("/bookings");
}

export async function recordPaymentAction(
  bookingId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(bookingId).success) return { message: "Booking not found." };
  const parsed = manualPaymentSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  return runAction(async () => {
    const session = await requirePermission("payments.create");
    if (!rateLimit(`pay:${session.userId}`, 60, 60_000).allowed)
      throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_payment", {
      p_booking: bookingId,
      p_amount: v.amount,
      p_method: v.method,
      p_reference: v.reference ?? null,
      p_paid_at: v.paidAt ? new Date(`${v.paidAt}T12:00:00Z`).toISOString() : null,
      p_notes: v.notes ?? null,
    });
    throwPaymentError(error, "record payment");
    refresh(bookingId);
    return { ok: true, message: "Payment recorded." };
  });
}

export async function addScheduleAction(
  bookingId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(bookingId).success) return { message: "Booking not found." };
  const parsed = scheduleSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  return runAction(async () => {
    await requirePermission("payments.create");
    const supabase = await createClient();
    const { error } = await supabase.from("payment_schedules").insert({
      booking_id: bookingId,
      label: v.label,
      due_date: v.dueDate,
      amount: v.amount,
    });
    throwPaymentError(error, "add schedule");
    refresh(bookingId);
    return { ok: true, message: "Instalment added." };
  });
}

export async function deleteScheduleAction(bookingId: string, id: string): Promise<FormState> {
  if (!uuid.safeParse(bookingId).success || !uuid.safeParse(id).success)
    return { message: "Not found." };
  return runAction(async () => {
    await requirePermission("payments.create");
    const supabase = await createClient();
    const { error } = await supabase
      .from("payment_schedules")
      .delete()
      .eq("id", id)
      .eq("booking_id", bookingId);
    throwPaymentError(error, "delete schedule");
    refresh(bookingId);
    return { ok: true, message: "Instalment removed." };
  });
}

export type OnlinePaymentResult = FormState & {
  checkout?: {
    keyId: string;
    orderId: string;
    amountMinor: number;
    currency: string;
    name: string;
  };
};

/**
 * Creates a PENDING payment row (amount validated against the balance in the database), then a Razorpay order for
 * exactly that amount. The browser only ever receives the public key id and the order id. The payment becomes
 * CAPTURED solely through the signed webhook, never because the browser says so.
 */
export async function startOnlinePaymentAction(
  bookingId: string,
  amount: number,
): Promise<OnlinePaymentResult> {
  const parsed = onlinePaymentSchema.safeParse({ bookingId, amount });
  if (!parsed.success) return { message: "Enter a valid amount." };
  try {
    const session = await requirePermission("payments.create");
    if (!rateLimit(`pay-online:${session.userId}`, 20, 60_000).allowed)
      throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
    const env = getServerEnv();
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET)
      throw new AppError("Online payments aren't configured yet.", "NOT_CONFIGURED", 503);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("prepare_online_payment", {
      p_booking: bookingId,
      p_amount: parsed.data.amount,
    });
    throwPaymentError(error, "prepare online payment");
    const row = (data as { payment_id: string; amount: number; currency: string }[] | null)?.[0];
    if (!row) throw new AppError("Booking not found.", "NOT_FOUND", 404);
    const amountMinor = toMinorUnits(Number(row.amount));

    try {
      const order = await createRazorpayOrder({
        keyId: env.RAZORPAY_KEY_ID,
        keySecret: env.RAZORPAY_KEY_SECRET,
        amountMinor,
        currency: row.currency,
        receipt: row.payment_id.replace(/-/g, ""),
      });
      const { error: attachError } = await supabase.rpc("attach_razorpay_order", {
        p_payment: row.payment_id,
        p_order: order.id,
      });
      throwPaymentError(attachError, "attach order");
      refresh(bookingId);
      return {
        ok: true,
        checkout: {
          keyId: env.RAZORPAY_KEY_ID,
          orderId: order.id,
          amountMinor,
          currency: row.currency,
          name: session.organization?.name ?? "Payment",
        },
      };
    } catch (error) {
      await supabase.rpc("discard_pending_payment", { p_payment: row.payment_id });
      if (error instanceof AppError) throw error;
      logger.error("razorpay order creation failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      throw new AppError("Couldn't start the online payment. Please try again.", "GATEWAY", 502);
    }
  } catch (error) {
    if (error instanceof AppError) return { message: error.message };
    logger.error("start online payment failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { message: "Something went wrong. Please try again." };
  }
}

export async function issueInvoiceAction(
  bookingId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(bookingId).success) return { message: "Booking not found." };
  const parsed = invoiceSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  return runAction(async () => {
    await requirePermission("payments.create");
    const supabase = await createClient();
    const { error } = await supabase.rpc("issue_invoice", {
      p_booking: bookingId,
      p_due: parsed.data.dueDate ?? null,
      p_notes: parsed.data.notes ?? null,
    });
    throwPaymentError(error, "issue invoice");
    refresh(bookingId);
    revalidatePath("/payments/invoices");
    return { ok: true, message: "Invoice issued." };
  });
}

export async function voidInvoiceAction(
  bookingId: string,
  invoiceId: string,
  reason: string,
): Promise<FormState> {
  if (!uuid.safeParse(bookingId).success || !uuid.safeParse(invoiceId).success)
    return { message: "Not found." };
  return runAction(async () => {
    await requirePermission("payments.create");
    const supabase = await createClient();
    const { error } = await supabase.rpc("void_invoice", {
      p_id: invoiceId,
      p_reason: reason.slice(0, 500),
    });
    throwPaymentError(error, "void invoice");
    refresh(bookingId);
    revalidatePath("/payments/invoices");
    return { ok: true, message: "Invoice voided." };
  });
}

export async function createRemindersAction(): Promise<FormState> {
  return runAction(async () => {
    await requirePermission("payments.create");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_payment_reminders", { p_days: 3 });
    throwPaymentError(error, "create reminders");
    revalidatePath("/payments");
    revalidatePath("/tasks");
    const n = Number(data ?? 0);
    return {
      ok: true,
      message: n ? `Created ${n} reminder task${n === 1 ? "" : "s"}.` : "No new reminders needed.",
    };
  });
}
