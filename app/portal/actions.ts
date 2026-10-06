"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { FormState } from "@/lib/auth/schemas";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { clientIp } from "@/lib/portal/queries";
import { hashPortalToken, isPortalToken } from "@/lib/portal/token";

/** A customer's note or change request. It becomes a high-priority task for the booking owner. */
export async function submitPortalRequestAction(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const message = String(formData.get("message") ?? "").trim();
  if (!isPortalToken(token)) return { message: "This link isn't valid." };
  if (message.length < 3) return { fieldErrors: { message: ["Please write a few words."] } };
  if (message.length > 1000)
    return { fieldErrors: { message: ["Please keep it under 1000 characters."] } };
  const ip = await clientIp();
  if (!rateLimit(`portal-req:${ip}`, 10, 60_000).allowed)
    return { message: "Too many requests. Please wait a moment." };
  const admin = createAdminClient();
  if (!admin) return { message: "This isn't available right now." };
  const { error } = await admin.rpc("portal_submit_request", {
    p_hash: hashPortalToken(token),
    p_message: message,
  });
  if (error) {
    if (error.code === "P0018")
      return { message: "You've sent several requests today. We'll get back to you soon." };
    if (error.code === "P0017") return { message: "This link has expired." };
    logger.error("portal request failed", { code: error.code });
    return { message: "Something went wrong. Please try again." };
  }
  return { ok: true, message: "Thank you. Your request has been sent to the team." };
}
