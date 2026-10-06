"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { rateLimit } from "@/lib/rate-limit";
import { formObject, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { deliverCommunication } from "@/lib/comms/deliver";
import { CHANNELS, TEMPLATE_KEYS } from "@/lib/comms/templates";
import { getBranding } from "@/lib/quotation/queries";

type DbError = { code?: string; message: string } | null;
export type SendState = FormState & { waUrl?: string };

function throwCommsError(error: DbError, context: string) {
  switch (error?.code) {
    case "P0002":
      throw new AppError("Customer, booking or message not found.", "NOT_FOUND", 404);
    case "P0014":
      throw new AppError("This customer has asked not to be contacted.", "DO_NOT_CONTACT", 409);
    case "P0015":
      throw new AppError(
        "The customer has no email or phone number for that channel.",
        "NO_ADDRESS",
        409,
      );
    case "22023":
      throw new AppError("Some values are invalid.", "INVALID_VALUE", 400);
  }
  throwIfDbError(error, context);
}

const sendSchema = z.object({
  channel: z.enum(CHANNELS),
  template: z.enum(TEMPLATE_KEYS),
  message: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
  ),
});

const fmt = (n: number) => n.toFixed(2);

/** Queues and delivers a message about a booking. Variables are built from the database, not the browser. */
export async function sendBookingMessageAction(
  bookingId: string,
  _prev: SendState,
  formData: FormData,
): Promise<SendState> {
  if (!uuid.safeParse(bookingId).success) return { message: "Booking not found." };
  const parsed = sendSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  try {
    const session = await requirePermission("communications.send");
    if (!rateLimit(`comms:${session.userId}`, 30, 60_000).allowed)
      throw new AppError("Too many messages. Please wait a moment.", "RATE_LIMITED", 429);
    const supabase = await createClient();
    const { data: b } = await supabase
      .from("bookings")
      .select(
        "id, customer_id, booking_number, title, destination, travel_start, currency, balance_amount, customers ( name )",
      )
      .eq("id", bookingId)
      .maybeSingle();
    if (!b) throw new AppError("Booking not found.", "NOT_FOUND", 404);
    const { data: next } = await supabase
      .from("payment_schedule_status")
      .select("label, due_date")
      .eq("booking_id", bookingId)
      .neq("schedule_status", "PAID")
      .order("due_date")
      .limit(1)
      .maybeSingle();
    const customer = b.customers as unknown as { name: string } | null;
    const vars: Record<string, string> = {
      customer_name: customer?.name ?? "",
      booking_number: b.booking_number as string,
      trip_title: b.title as string,
      destination: (b.destination as string | null) ?? "",
      travel_start: (b.travel_start as string | null) ?? "",
      amount_due: fmt(Number(b.balance_amount)),
      currency: b.currency as string,
      due_date: (next?.due_date as string | undefined) ?? "",
      installment: (next?.label as string | undefined) ?? "Balance",
      message: v.message ?? "",
    };
    const { data: id, error } = await supabase.rpc("queue_communication", {
      p_channel: v.channel,
      p_template: v.template,
      p_customer: b.customer_id,
      p_booking: bookingId,
      p_vars: vars,
    });
    throwCommsError(error, "queue communication");
    const branding = await getBranding();
    const result = await deliverCommunication(
      supabase,
      id as string,
      session.organization?.name ?? "Your travel agency",
      branding?.email ?? null,
    );
    revalidatePath("/communications");
    revalidatePath(`/bookings/${bookingId}`);
    return { ok: result.status === "SENT", message: result.message, waUrl: result.waUrl };
  } catch (error) {
    if (error instanceof AppError) return { message: error.message };
    return { message: "Something went wrong. Please try again." };
  }
}

/** Sends a draft (typically one created by automation) after a person has looked at it. */
export async function sendQueuedAction(id: string): Promise<SendState> {
  if (!uuid.safeParse(id).success) return { message: "Message not found." };
  try {
    const session = await requirePermission("communications.send");
    if (!rateLimit(`comms:${session.userId}`, 30, 60_000).allowed)
      throw new AppError("Too many messages. Please wait a moment.", "RATE_LIMITED", 429);
    const supabase = await createClient();
    const branding = await getBranding();
    const result = await deliverCommunication(
      supabase,
      id,
      session.organization?.name ?? "Your travel agency",
      branding?.email ?? null,
    );
    revalidatePath("/communications");
    return { ok: result.status === "SENT", message: result.message, waUrl: result.waUrl };
  } catch (error) {
    if (error instanceof AppError) return { message: error.message };
    return { message: "Something went wrong. Please try again." };
  }
}

export async function cancelQueuedAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Message not found." };
  return runAction(async () => {
    await requirePermission("communications.send");
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_communication", { p_id: id });
    throwCommsError(error, "cancel communication");
    revalidatePath("/communications");
    return { ok: true, message: "Discarded." };
  });
}

const templateSchema = z.object({
  subject: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(200).optional(),
  ),
  body: z.string().trim().min(1, "Write a message.").max(5000),
});

export async function saveTemplateAction(
  key: string,
  channel: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const k = TEMPLATE_KEYS.find((x) => x === key);
  const c = CHANNELS.find((x) => x === channel);
  if (!k || !c) return { message: "Unknown template." };
  const parsed = templateSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  return runAction(async () => {
    await requirePermission("communications.manage");
    const supabase = await createClient();
    const { error } = await supabase
      .from("message_templates")
      .upsert(
        {
          template_key: k,
          channel: c,
          subject: c === "EMAIL" ? (parsed.data.subject ?? null) : null,
          body: parsed.data.body,
        },
        { onConflict: "organization_id,template_key,channel" },
      );
    throwCommsError(error, "save template");
    revalidatePath("/communications/templates");
    return { ok: true, message: "Template saved." };
  });
}

export async function resetTemplateAction(key: string, channel: string): Promise<FormState> {
  const k = TEMPLATE_KEYS.find((x) => x === key);
  const c = CHANNELS.find((x) => x === channel);
  if (!k || !c) return { message: "Unknown template." };
  return runAction(async () => {
    await requirePermission("communications.manage");
    const supabase = await createClient();
    const { error } = await supabase
      .from("message_templates")
      .delete()
      .eq("template_key", k)
      .eq("channel", c);
    throwCommsError(error, "reset template");
    revalidatePath("/communications/templates");
    return { ok: true, message: "Back to the default." };
  });
}

const RULES = {
  PAYMENT_DUE_SOON: "PAYMENT_REMINDER",
  PAYMENT_OVERDUE: "PAYMENT_OVERDUE",
  TRAVEL_UPCOMING: "TRIP_REMINDER",
} as const;

export async function saveRuleAction(
  trigger: string,
  channel: string,
  enabled: boolean,
  days: number,
): Promise<FormState> {
  const t = (Object.keys(RULES) as (keyof typeof RULES)[]).find((x) => x === trigger);
  const c = CHANNELS.find((x) => x === channel);
  if (!t || !c || !Number.isInteger(days) || days < 0 || days > 60)
    return { message: "Invalid rule." };
  return runAction(async () => {
    await requirePermission("communications.manage");
    const supabase = await createClient();
    const { error } = await supabase
      .from("automation_rules")
      .upsert(
        { trigger: t, channel: c, template_key: RULES[t], days, enabled },
        { onConflict: "organization_id,trigger,channel" },
      );
    throwCommsError(error, "save rule");
    revalidatePath("/communications/templates");
    return { ok: true, message: "Rule saved." };
  });
}
