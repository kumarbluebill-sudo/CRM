"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/auth/platform";
import { requireRecentAuth } from "@/lib/auth/recent";
import { getServerEnv } from "@/lib/env.server";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";
import { rateLimit } from "@/lib/rate-limit";
import { runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { refundRazorpayPayment } from "@/lib/payments/razorpay";

async function guard(key: string, next: string) {
  const { userId } = await assertPlatformAdmin();
  if (!(await rateLimit(`${key}:${userId}`, 30, 60_000)).allowed)
    throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
  await requireRecentAuth(10, next);
  return userId;
}

const num = (min = 0) =>
  z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : Number(v)),
    z.number().int().min(min).optional(),
  );
const flag = z.preprocess((v) => v === "on" || v === "true", z.boolean());

const planSchema = z.object({
  key: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,19}$/, "Use capital letters, digits or _ (2 to 20 characters)"),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(300).optional(),
  priceRupees: z.preprocess((v) => Number(v), z.number().min(0).max(10_000_000)),
  features: z.string().max(2000).optional(),
  seats: num(0),
  branches: num(0),
  bookingsPerMonth: num(0),
  storageMb: num(0),
  exportsPerMonth: num(0),
  aiOrgDaily: num(0),
  aiUserDaily: num(0),
  razorpayPlanId: z
    .string()
    .trim()
    .regex(/^(plan_[A-Za-z0-9]+)?$/, "It looks like plan_XXXXXXXX")
    .optional(),
  sort: num(0),
  active: flag,
  isPublic: flag,
  contactSales: flag,
});

export async function savePlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = planSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const v = parsed.data;
  return runAction(async () => {
    await guard("admin-plan", "/admin/plans");
    const limits = Object.fromEntries(
      Object.entries({
        seats: v.seats,
        branches: v.branches,
        bookingsPerMonth: v.bookingsPerMonth,
        storageMb: v.storageMb,
        exportsPerMonth: v.exportsPerMonth,
        aiOrgDaily: v.aiOrgDaily,
        aiUserDaily: v.aiUserDaily,
      }).filter(([, n]) => n !== undefined),
    );
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_save_plan", {
      p: {
        key: v.key,
        name: v.name,
        description: v.description ?? "",
        pricePaise: Math.round(v.priceRupees * 100),
        interval: "month",
        limits,
        features: (v.features ?? "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 20),
        active: v.active,
        isPublic: v.isPublic,
        contactSales: v.contactSales,
        razorpayPlanId: v.razorpayPlanId ?? "",
        sort: v.sort ?? 10,
      },
    });
    if (error?.code === "23505")
      throw new AppError(
        "That payment-provider plan id is already used by another plan.",
        "DUPLICATE",
        409,
      );
    throwIfDbError(error, "save plan");
    revalidatePath("/admin/plans");
    revalidatePath("/settings/billing");
    return { ok: true, message: "Plan saved." };
  });
}

const settingsSchema = z.object({ graceDays: num(0), pastDueDays: num(0), trialDays: num(0) });

export async function saveBillingSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { message: "Enter whole numbers of days." };
  return runAction(async () => {
    await guard("admin-settings", "/admin/plans");
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_billing_settings", { p: parsed.data });
    throwIfDbError(error, "save billing settings");
    revalidatePath("/admin/plans");
    return { ok: true, message: "Billing rules saved." };
  });
}

const STATUSES = [
  "ACTIVE",
  "SUSPENDED",
  "EXPIRED",
  "CANCELLED",
  "GRACE_PERIOD",
  "PAYMENT_PENDING",
] as const;
const changeSchema = z.object({
  plan: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,19}$/)
    .optional()
    .or(z.literal("")),
  status: z.enum(STATUSES).optional().or(z.literal("")),
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(200),
});

export async function adminChangeSubscriptionAction(
  orgId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(orgId).success) return { message: "Agency not found." };
  const parsed = changeSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  return runAction(async () => {
    await guard("admin-sub", `/admin/organizations/${orgId}`);
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_set_subscription", {
      p_org: orgId,
      p_plan: parsed.data.plan || null,
      p_status: parsed.data.status || null,
      p_reason: parsed.data.reason,
    });
    if (error?.code === "P0080")
      throw new AppError(
        "That status change is not allowed from the current status.",
        "TRANSITION",
        409,
      );
    throwIfDbError(error, "admin set subscription");
    revalidatePath(`/admin/organizations/${orgId}`);
    return { ok: true, message: "Subscription updated and recorded." };
  });
}

/** Refund at the gateway first; only when that succeeds is it recorded. Needs a reason and a recent password check. */
export async function refundPaymentAction(
  orgId: string,
  paymentId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(orgId).success || !uuid.safeParse(paymentId).success)
    return { message: "Payment not found." };
  const parsed = z
    .object({
      rupees: z.preprocess((v) => Number(v), z.number().positive().max(10_000_000)),
      reason: z.string().trim().min(5).max(200),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { message: "Enter an amount and a reason." };
  return runAction(async () => {
    await guard("admin-refund", `/admin/organizations/${orgId}`);
    const env = getServerEnv();
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)
      throw new AppError("The payment provider is not configured.", "NOT_CONFIGURED", 503);
    const supabase = await createClient();
    const { data: providerId, error: e1 } = await supabase.rpc("admin_payment_provider_id", {
      p_payment: paymentId,
    });
    throwIfDbError(e1, "read payment");
    if (typeof providerId !== "string") throw new AppError("Payment not found.", "NOT_FOUND", 404);
    const amountPaise = Math.round(parsed.data.rupees * 100);
    // the gateway call comes first so the ledger never claims a refund that did not happen
    try {
      await refundRazorpayPayment({
        keyId: env.RAZORPAY_KEY_ID,
        keySecret: env.RAZORPAY_KEY_SECRET,
        paymentId: providerId,
        amountPaise,
      });
    } catch (e) {
      logger.error("refund failed", { error: e instanceof Error ? e.message : "unknown" });
      throw new AppError("The payment provider refused the refund.", "GATEWAY", 502);
    }
    const { error } = await supabase.rpc("admin_record_refund", {
      p_payment: paymentId,
      p_amount_paise: amountPaise,
      p_reason: parsed.data.reason,
    });
    if (error?.code === "P0081")
      throw new AppError("That refund is not possible for this payment.", "REFUND_RULE", 409);
    throwIfDbError(error, "record refund");
    revalidatePath(`/admin/organizations/${orgId}`);
    return { ok: true, message: "Refund made and recorded." };
  });
}
