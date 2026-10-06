"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { getPublicEnv } from "@/lib/env";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { rateLimit } from "@/lib/rate-limit";
import { runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { generatePortalToken, hashPortalToken } from "@/lib/portal/token";

type DbError = { code?: string; message: string } | null;

function throwPortalError(error: DbError, context: string) {
  switch (error?.code) {
    case "P0002":
      throw new AppError("Booking, link or document not found.", "NOT_FOUND", 404);
    case "P0011":
      throw new AppError("Links can only be created for active bookings.", "NOT_ACTIVE", 409);
    case "P0016":
      throw new AppError("Passport and visa documents can't be shared.", "SENSITIVE", 409);
  }
  throwIfDbError(error, context);
}

export type PortalLinkResult = FormState & { url?: string };

/**
 * Creates a customer link. The raw token is returned once so staff can copy it; only its hash is stored, so it can
 * never be shown again (create a new link instead).
 */
export async function createPortalLinkAction(
  bookingId: string,
  days: number,
): Promise<PortalLinkResult> {
  if (!uuid.safeParse(bookingId).success) return { message: "Booking not found." };
  try {
    const session = await requirePermission("portal.manage");
    if (!(await rateLimit(`portal-link:${session.userId}`, 20, 60_000)).allowed)
      throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
    const token = generatePortalToken();
    const supabase = await createClient();
    const { error } = await supabase.rpc("create_portal_link", {
      p_booking: bookingId,
      p_hash: hashPortalToken(token),
      p_days: Math.max(1, Math.min(Math.trunc(days) || 30, 180)),
    });
    throwPortalError(error, "create portal link");
    revalidatePath(`/bookings/${bookingId}`);
    return {
      ok: true,
      message: "Link created. Copy it now: it can't be shown again.",
      url: `${getPublicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/portal/${token}`,
    };
  } catch (error) {
    if (error instanceof AppError) return { message: error.message };
    return { message: "Something went wrong. Please try again." };
  }
}

export async function revokePortalLinkAction(bookingId: string, id: string): Promise<FormState> {
  if (!uuid.safeParse(bookingId).success || !uuid.safeParse(id).success)
    return { message: "Not found." };
  return runAction(async () => {
    await requirePermission("portal.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_portal_link", { p_id: id });
    throwPortalError(error, "revoke portal link");
    revalidatePath(`/bookings/${bookingId}`);
    return { ok: true, message: "Link revoked." };
  });
}

export async function setDocumentSharedAction(
  bookingId: string,
  id: string,
  visible: boolean,
): Promise<FormState> {
  if (!uuid.safeParse(bookingId).success || !uuid.safeParse(id).success)
    return { message: "Not found." };
  return runAction(async () => {
    await requirePermission("portal.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_document_portal_visible", {
      p_id: id,
      p_visible: visible,
    });
    throwPortalError(error, "share document");
    revalidatePath(`/bookings/${bookingId}`);
    return { ok: true, message: visible ? "Shared with the customer." : "No longer shared." };
  });
}
