"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOrgSession } from "@/lib/auth/session";
import { requireRecentAuth } from "@/lib/auth/recent";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/utils/request";
import { runAction, throwIfDbError } from "@/lib/crm/action-utils";

async function guard(key: string, limit = 10) {
  const session = await requireOrgSession();
  if (!(await rateLimit(`${key}:${session.userId}`, limit, 10 * 60_000)).allowed)
    throw new AppError("Too many attempts. Please wait a few minutes.", "RATE_LIMITED", 429);
  return session;
}

export type EnrolStart = FormState & { factorId?: string; qr?: string; secret?: string };

/** Starts setting up an authenticator app. Any half-finished earlier attempt is discarded first. */
export async function startEnrolAction(): Promise<EnrolStart> {
  try {
    await guard("mfa-enrol");
    const supabase = await createClient();
    const { data: factors } = await supabase.auth.mfa.listFactors();
    for (const f of factors?.all ?? [])
      if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator app",
    });
    if (error || !data)
      throw new AppError("Could not start setup. Please try again.", "MFA_ENROL", 400);
    return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
  } catch (error) {
    if (error instanceof AppError) return { message: error.message };
    throw error;
  }
}

/** Finishes setup by checking a first code. From then on this account needs the code at every sign-in. */
export async function confirmEnrolAction(factorId: string, code: string): Promise<FormState> {
  if (!/^[0-9a-f-]{36}$/i.test(factorId)) return { message: "Start the setup again." };
  if (!/^[0-9]{6}$/.test(code.replace(/\s/g, "")))
    return { message: "Enter the 6-digit code from the app." };
  return runAction(async () => {
    await guard("mfa-confirm");
    const supabase = await createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.replace(/\s/g, ""),
    });
    if (error)
      throw new AppError("That code didn't work. Check the app and try again.", "MFA_CODE", 400);
    await supabase.rpc("log_my_security_event", { p_kind: "MFA_ENROLLED", p_ip: await clientIp() });
    revalidatePath("/profile/security");
    return { ok: true, message: "Two-step verification is on." };
  });
}

export async function removeFactorAction(factorId: string): Promise<FormState> {
  if (!/^[0-9a-f-]{36}$/i.test(factorId)) return { message: "Not found." };
  return runAction(async () => {
    const session = await guard("mfa-remove", 6);
    await requireRecentAuth();
    const supabase = await createClient();
    // administrators cannot switch it off while the agency requires it
    if (session.role === "OWNER" || session.role === "ADMIN") {
      const { data: settings } = await supabase
        .from("organization_settings")
        .select("require_admin_mfa")
        .maybeSingle();
      if (settings?.require_admin_mfa)
        throw new AppError(
          "Your agency requires two-step verification for owners and admins.",
          "MFA_REQUIRED_POLICY",
          409,
        );
    }
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw new AppError("Could not remove it. Please try again.", "MFA_REMOVE", 400);
    await supabase.rpc("log_my_security_event", { p_kind: "MFA_REMOVED", p_ip: await clientIp() });
    revalidatePath("/profile/security");
    return { ok: true, message: "Two-step verification removed." };
  });
}

/** Signs this account out of every device, this one included. */
export async function signOutEverywhereAction(): Promise<FormState> {
  await guard("sessions-revoke", 5);
  const supabase = await createClient();
  await supabase.rpc("log_my_security_event", {
    p_kind: "SESSIONS_REVOKED",
    p_ip: await clientIp(),
  });
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}

/** Signs out every other device but keeps this one. */
export async function signOutOthersAction(): Promise<FormState> {
  return runAction(async () => {
    await guard("sessions-revoke", 5);
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: "others" });
    if (error) throw new AppError("Could not sign out the other devices.", "SIGNOUT", 400);
    await supabase.rpc("log_my_security_event", {
      p_kind: "SESSIONS_REVOKED",
      p_ip: await clientIp(),
      p_detail: "other devices",
    });
    return { ok: true, message: "Every other device has been signed out." };
  });
}

export async function setRequireAdminMfaAction(on: boolean): Promise<FormState> {
  return runAction(async () => {
    const session = await guard("mfa-policy", 10);
    if (!session.permissions.has("settings.manage"))
      throw new AppError("You don't have permission to do that.", "FORBIDDEN", 403);
    await requireRecentAuth();
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_require_admin_mfa", { p_on: on });
    if (error?.code === "P0070")
      throw new AppError(
        "Set up two-step verification on your own account first.",
        "MFA_FIRST",
        409,
      );
    throwIfDbError(error, "set admin MFA policy");
    revalidatePath("/profile/security");
    revalidatePath("/settings/security");
    return {
      ok: true,
      message: on
        ? "Owners and admins must now use two-step verification."
        : "The requirement was turned off.",
    };
  });
}
