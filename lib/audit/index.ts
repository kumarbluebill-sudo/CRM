import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/utils/logger";

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "LOGIN_FAILED"
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "VIEW"
  | "DOWNLOAD"
  | "UPLOAD"
  | "EXPORT"
  | "PAYMENT"
  | "PERMISSION_CHANGE"
  | "SETTINGS_CHANGE"
  | "STATUS_CHANGE"
  | "CONVERT";

/**
 * Records a sensitive operation through the write_audit() database function (append-only, RLS-scoped).
 * Failures are logged but never block the user's action. Never pass secrets: the function also strips
 * secret-looking keys, but callers should send identifiers, not content.
 */
export async function audit(
  supabase: SupabaseClient,
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
    const { error } = await supabase.rpc("write_audit", {
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_metadata: metadata,
      p_ip: ip,
      p_user_agent: h.get("user-agent"),
    });
    if (error) logger.warn("audit write failed", { code: error.code });
  } catch (error) {
    logger.warn("audit write failed", { error: error instanceof Error ? error.name : "unknown" });
  }
}
