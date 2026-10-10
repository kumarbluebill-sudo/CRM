import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/utils/logger";

/**
 * Records a security event that happens before anyone is signed in (failed password, throttled attempt). The e-mail is
 * used only to find which agency the account belongs to and is never stored; the address is truncated by the database.
 * Best effort: a logging problem must never change the sign-in outcome.
 */
export async function logSecurityEvent(
  kind: "LOGIN_FAILED" | "LOGIN_THROTTLED" | "MFA_FAILED" | "IDLE_TIMEOUT",
  email: string | null,
  ip: string,
  detail?: string,
) {
  try {
    const admin = createAdminClient();
    if (!admin) return;
    const { error } = await admin.rpc("log_security_event", {
      p_kind: kind,
      p_email: email,
      p_ip: ip,
      p_detail: detail ?? null,
    });
    if (error) logger.warn("security event not recorded", { code: error.code });
  } catch (e) {
    logger.warn("security event not recorded", {
      error: e instanceof Error ? e.message : "unknown",
    });
  }
}
