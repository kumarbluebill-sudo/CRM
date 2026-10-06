"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";
import { rateLimit } from "@/lib/rate-limit";
import { formObject, runAction } from "@/lib/crm/action-utils";
import { sealForOrg } from "@/lib/payments/credentials";
import { verifyRazorpayCredentials } from "@/lib/payments/razorpay";
import { getServerEnv } from "@/lib/env.server";

const schema = z.object({
  keyId: z
    .string()
    .trim()
    .regex(
      /^rzp_(test|live)_[A-Za-z0-9]{6,40}$/,
      "That doesn't look like a Razorpay key id (rzp_test_… or rzp_live_…).",
    ),
  keySecret: z.string().trim().min(8, "Enter the key secret.").max(200),
  webhookSecret: z
    .string()
    .trim()
    .min(8, "Use at least 8 characters.")
    .max(200)
    .regex(/^[\x21-\x7e]+$/, "Use letters, numbers and symbols only (no spaces)."),
});

/**
 * Saves the agency's own Razorpay credentials. They are checked against Razorpay, encrypted with the server-side key
 * (bound to this organization), and stored where no browser role can read them. They are never shown again; only the
 * last four characters of the key id are.
 */
export async function savePaymentSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = schema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  return runAction(async () => {
    const session = await requirePermission("settings.manage");
    if (!(await rateLimit(`pay-settings:${session.userId}`, 10, 60_000)).allowed)
      throw new AppError("Too many attempts. Please wait a moment.", "RATE_LIMITED", 429);
    const admin = createAdminClient();
    if (!admin || !getServerEnv().ENCRYPTION_KEY)
      throw new AppError(
        "Secure storage isn't configured on the server yet.",
        "NOT_CONFIGURED",
        503,
      );

    if (!(await verifyRazorpayCredentials(parsed.data.keyId, parsed.data.keySecret)))
      throw new AppError(
        "Razorpay rejected those keys. Check the key id and secret.",
        "BAD_CREDENTIALS",
        400,
      );

    const orgId = session.organization!.id;
    let sealed;
    try {
      sealed = sealForOrg(orgId, parsed.data.keySecret, parsed.data.webhookSecret);
    } catch (error) {
      logger.error("seal failed", { error: error instanceof Error ? error.message : "unknown" });
      throw new AppError(
        "Secure storage isn't configured correctly on the server.",
        "NOT_CONFIGURED",
        503,
      );
    }
    const { error } = await admin.from("organization_payment_settings").upsert({
      organization_id: orgId,
      key_id: parsed.data.keyId,
      ...sealed,
      updated_by: session.userId,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      logger.error("save payment settings failed", { code: error.code });
      throw new AppError("Couldn't save. Please try again.", "DB", 500);
    }
    await audit(await createClient(), "SETTINGS_CHANGE", "payment_settings", null, {
      event: "razorpay_connected",
      mode: parsed.data.keyId.startsWith("rzp_live_") ? "live" : "test",
    });
    revalidatePath("/settings/payments");
    return {
      ok: true,
      message: "Razorpay connected. Now add the webhook shown above in your Razorpay dashboard.",
    };
  });
}

export async function removePaymentSettingsAction(): Promise<FormState> {
  return runAction(async () => {
    const session = await requirePermission("settings.manage");
    const admin = createAdminClient();
    if (!admin) throw new AppError("Not configured.", "NOT_CONFIGURED", 503);
    await admin
      .from("organization_payment_settings")
      .delete()
      .eq("organization_id", session.organization!.id);
    await audit(await createClient(), "SETTINGS_CHANGE", "payment_settings", null, {
      event: "razorpay_removed",
    });
    revalidatePath("/settings/payments");
    return { ok: true, message: "Razorpay disconnected. Online payments are switched off." };
  });
}
