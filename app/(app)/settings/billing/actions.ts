"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env.server";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";
import { rateLimit } from "@/lib/rate-limit";
import { throwIfDbError } from "@/lib/crm/action-utils";
import { cancelRazorpaySubscription, createRazorpaySubscription } from "@/lib/payments/razorpay";

type DbError = { code?: string; message: string } | null;

function throwBillingError(error: DbError, context: string) {
  switch (error?.code) {
    case "P0002":
      throw new AppError("That plan or subscription wasn't found.", "NOT_FOUND", 404);
    case "P0021":
      throw new AppError(
        "This plan can't be purchased online yet. Please contact support.",
        "NOT_PURCHASABLE",
        409,
      );
  }
  throwIfDbError(error, context);
}

export type CheckoutResult = FormState & { url?: string };

/**
 * Starts a plan purchase. The plan id sent to Razorpay is looked up in the database (never taken from the browser),
 * the organization comes from the session, and access only changes when Razorpay's signed webhook says the
 * subscription is active. The returned URL is validated to be https before it reaches the browser.
 */
export async function startCheckoutAction(planKey: string): Promise<CheckoutResult> {
  try {
    const session = await requirePermission("billing.manage");
    if (!(await rateLimit(`billing:${session.userId}`, 5, 60_000)).allowed)
      throw new AppError("Too many attempts. Please wait a moment.", "RATE_LIMITED", 429);
    const env = getServerEnv();
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET)
      throw new AppError(
        "Billing isn't configured yet. Please contact support.",
        "NOT_CONFIGURED",
        503,
      );

    const supabase = await createClient();
    const { data: rzpPlan, error } = await supabase.rpc("prepare_subscription", {
      p_plan: planKey,
    });
    throwBillingError(error, "prepare subscription");

    let sub;
    try {
      sub = await createRazorpaySubscription({
        keyId: env.RAZORPAY_KEY_ID,
        keySecret: env.RAZORPAY_KEY_SECRET,
        planId: rzpPlan as string,
        organizationId: session.organization!.id,
      });
    } catch (e) {
      logger.error("razorpay subscription failed", {
        error: e instanceof Error ? e.message : "unknown",
      });
      throw new AppError("Couldn't start checkout. Please try again.", "GATEWAY", 502);
    }
    const { error: attachError } = await supabase.rpc("attach_subscription", {
      p_plan: planKey,
      p_sub: sub.id,
    });
    throwBillingError(attachError, "attach subscription");
    revalidatePath("/settings/billing");
    return { ok: true, url: sub.shortUrl };
  } catch (error) {
    if (error instanceof AppError) return { message: error.message };
    logger.error("checkout failed", { error: error instanceof Error ? error.message : "unknown" });
    return { message: "Something went wrong. Please try again." };
  }
}

/** Cancels at the end of the paid period; access continues until then. */
export async function cancelSubscriptionAction(): Promise<FormState> {
  try {
    const session = await requirePermission("billing.manage");
    if (!(await rateLimit(`billing:${session.userId}`, 5, 60_000)).allowed)
      throw new AppError("Too many attempts. Please wait a moment.", "RATE_LIMITED", 429);
    const env = getServerEnv();
    const admin = createAdminClient();
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !admin)
      throw new AppError(
        "Billing isn't configured yet. Please contact support.",
        "NOT_CONFIGURED",
        503,
      );

    // The Razorpay subscription id is not readable by browsers; fetch it for the caller's own organization only.
    const { data } = await admin
      .from("subscriptions")
      .select("razorpay_subscription_id, status")
      .eq("organization_id", session.organization!.id)
      .maybeSingle();
    const subId = data?.razorpay_subscription_id as string | undefined;
    if (!subId || !["ACTIVE", "PAST_DUE"].includes(data?.status as string))
      throw new AppError("There's no active subscription to cancel.", "NOT_FOUND", 404);

    try {
      await cancelRazorpaySubscription({
        keyId: env.RAZORPAY_KEY_ID,
        keySecret: env.RAZORPAY_KEY_SECRET,
        subscriptionId: subId,
      });
    } catch (e) {
      logger.error("razorpay cancel failed", { error: e instanceof Error ? e.message : "unknown" });
      throw new AppError("Couldn't cancel right now. Please try again.", "GATEWAY", 502);
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("mark_cancel_requested");
    throwBillingError(error, "mark cancel requested");
    revalidatePath("/settings/billing");
    return { ok: true, message: "Your plan will end at the close of the current billing period." };
  } catch (error) {
    if (error instanceof AppError) return { message: error.message };
    logger.error("cancel subscription failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { message: "Something went wrong. Please try again." };
  }
}
