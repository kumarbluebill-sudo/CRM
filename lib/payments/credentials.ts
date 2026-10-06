import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env.server";
import { decryptSecret, encryptSecret, parseKey } from "@/lib/crypto/secretbox";

export type OrgRazorpay = { keyId: string; keySecret: string; webhookSecret: string };

/**
 * An agency's own Razorpay credentials, decrypted for one server-side call. Customer payments go to the agency's
 * account, never the platform's. The caller must already have established which organization it is acting for.
 * Returns null when nothing is configured (online payments are then simply unavailable).
 */
export async function getOrgRazorpay(organizationId: string): Promise<OrgRazorpay | null> {
  const admin = createAdminClient();
  const encKey = getServerEnv().ENCRYPTION_KEY;
  if (!admin || !encKey) return null;
  const { data } = await admin
    .from("organization_payment_settings")
    .select("key_id, key_secret_enc, webhook_secret_enc")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return null;
  try {
    const key = parseKey(encKey);
    return {
      keyId: data.key_id as string,
      keySecret: decryptSecret(data.key_secret_enc as string, key, organizationId),
      webhookSecret: decryptSecret(data.webhook_secret_enc as string, key, organizationId),
    };
  } catch {
    return null; // wrong key or tampered value: treat as not configured, never throw secrets into logs
  }
}

export function sealForOrg(organizationId: string, keySecret: string, webhookSecret: string) {
  const key = parseKey(getServerEnv().ENCRYPTION_KEY);
  return {
    key_secret_enc: encryptSecret(keySecret, key, organizationId),
    webhook_secret_enc: encryptSecret(webhookSecret, key, organizationId),
  };
}
