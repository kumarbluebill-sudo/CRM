"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/session";
import { requireRecentAuth } from "@/lib/auth/recent";
import { getServerEnv } from "@/lib/env.server";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";
import { rateLimit } from "@/lib/rate-limit";
import { throwIfDbError } from "@/lib/crm/action-utils";
import {
  cancelRazorpaySubscription,
  changeRazorpaySubscriptionPlan,
  createRazorpaySubscription,
} from "@/lib/payments/razorpay";

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

export type PlanPreview = FormState & {
  overLimit?: { item: string; used: number; limit: number }[];
  direction?: "upgrade" | "downgrade";
};

/** What changing to a plan would mean for this agency. Reads only; nothing changes. */
export async function previewPlanChangeAction(planKey: string): Promise<PlanPreview> {
  try {
    await requirePermission("billing.manage");
    const supabase = await createClient();
    const [{ data, error }, { data: plans }, limits] = await Promise.all([
      supabase.rpc("plan_change_preview", { p_plan: planKey }),
      supabase.from("plans").select("key, price_paise").in("key", [planKey]),
      supabase.rpc("org_limits"),
    ]);
    throwBillingError(error, "plan change preview");
    const current = (limits.data as { planKey?: string } | null)?.planKey;
    const { data: cur } = await supabase
      .from("plans")
      .select("price_paise")
      .eq("key", current ?? "")
      .maybeSingle();
    const direction =
      (plans?.[0]?.price_paise as number) >= ((cur?.price_paise as number | undefined) ?? 0)
        ? "upgrade"
        : "downgrade";
    return {
      ok: true,
      overLimit: (data as { overLimit: PlanPreview["overLimit"] }).overLimit ?? [],
      direction,
    };
  } catch (error) {
    if (error instanceof AppError) return { message: error.message };
    return { message: "Something went wrong. Please try again." };
  }
}

/**
 * Moves a paying agency to another plan at the gateway: upgrades now, downgrades at the end of the paid cycle.
 * Nothing is deleted. The new plan only takes effect when the gateway's signed webhook confirms the change.
 */
export async function changePlanAction(planKey: string): Promise<FormState> {
  try {
    const session = await requirePermission("billing.manage");
    await requireRecentAuth();
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

    const { data: sub } = await admin
      .from("subscriptions")
      .select("razorpay_subscription_id, status, plan_key")
      .eq("organization_id", session.organization!.id)
      .maybeSingle();
    if (!sub?.razorpay_subscription_id || sub.status !== "ACTIVE")
      throw new AppError(
        "Plan changes are available while your subscription is active.",
        "NOT_ACTIVE",
        409,
      );
    if (sub.plan_key === planKey)
      throw new AppError("You're already on that plan.", "NO_CHANGE", 409);

    const supabase = await createClient();
    const { data: rzpPlan, error } = await supabase.rpc("prepare_subscription", {
      p_plan: planKey,
    });
    throwBillingError(error, "prepare plan change");
    const { data: prices } = await admin
      .from("plans")
      .select("key, price_paise")
      .in("key", [planKey, sub.plan_key as string]);
    const price = (k: string) =>
      (prices ?? []).find((p) => p.key === k)?.price_paise as number | undefined;
    const upgrade = (price(planKey) ?? 0) > (price(sub.plan_key as string) ?? 0);

    try {
      await changeRazorpaySubscriptionPlan({
        keyId: env.RAZORPAY_KEY_ID,
        keySecret: env.RAZORPAY_KEY_SECRET,
        subscriptionId: sub.razorpay_subscription_id as string,
        planId: rzpPlan as string,
        when: upgrade ? "now" : "cycle_end",
      });
    } catch (e) {
      logger.error("razorpay plan change failed", {
        error: e instanceof Error ? e.message : "unknown",
      });
      throw new AppError("Couldn't change the plan right now. Please try again.", "GATEWAY", 502);
    }
    const { error: attachError } = await supabase.rpc("attach_subscription", {
      p_plan: planKey,
      p_sub: sub.razorpay_subscription_id as string,
    });
    throwBillingError(attachError, "record plan change");
    revalidatePath("/settings/billing");
    return {
      ok: true,
      message: upgrade
        ? "Upgrading now. Your new limits apply as soon as the payment is confirmed."
        : "Your plan will change at the end of the current billing period.",
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
    )
      throw error;
    if (error instanceof AppError) return { message: error.message };
    logger.error("change plan failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { message: "Something went wrong. Please try again." };
  }
}
