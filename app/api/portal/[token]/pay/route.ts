import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgRazorpay } from "@/lib/payments/credentials";
import { createRazorpayOrder, toMinorUnits } from "@/lib/payments/razorpay";
import { clientIp } from "@/lib/portal/queries";
import { hashPortalToken, isPortalToken } from "@/lib/portal/token";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
const json = (status: number, error: string) => NextResponse.json({ error }, { status });
const body = z.object({ amount: z.number().positive().max(1_000_000_000).multipleOf(0.01) });

/**
 * Customer-initiated online payment. The token proves which booking; the database validates the amount against the
 * balance; the payment becomes paid only through the signed Razorpay webhook.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!isPortalToken(token)) return json(404, "This link isn't valid.");
  const ip = await clientIp();
  if (
    !(await rateLimit(`portal-pay:${ip}`, 10, 60_000)).allowed ||
    !(await rateLimit(`portal-pay-t:${token.slice(0, 12)}`, 10, 60_000)).allowed
  )
    return json(429, "Too many attempts. Please wait a moment.");
  if (Number(req.headers.get("content-length") ?? 0) > 1024) return json(413, "Too large.");

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, "Enter a valid amount.");
  const admin = createAdminClient();
  if (!admin) return json(503, "Online payment isn't available yet. Please contact us.");

  const hash = hashPortalToken(token);
  // The agency's own Razorpay account receives the money.
  const { data: orgId } = await admin.rpc("portal_org", { p_hash: hash });
  const creds = typeof orgId === "string" ? await getOrgRazorpay(orgId) : null;
  if (!creds) return json(503, "Online payment isn't available yet. Please contact us.");

  const { data, error } = await admin.rpc("portal_prepare_payment", {
    p_hash: hash,
    p_amount: parsed.data.amount,
  });
  if (error) {
    if (error.code === "P0012") return json(409, "That's more than the balance due.");
    if (error.code === "P0011") return json(409, "This booking can't take payments right now.");
    if (error.code === "P0017") return json(404, "This link has expired.");
    logger.error("portal prepare payment failed", { code: error.code });
    return json(500, "Something went wrong.");
  }
  const row = (
    data as { payment_id: string; amount: number; currency: string; org_name: string }[] | null
  )?.[0];
  if (!row) return json(500, "Something went wrong.");
  const amountMinor = toMinorUnits(Number(row.amount));
  try {
    const order = await createRazorpayOrder({
      keyId: creds.keyId,
      keySecret: creds.keySecret,
      amountMinor,
      currency: row.currency,
      receipt: row.payment_id.replace(/-/g, ""),
    });
    const { error: attachError } = await admin.rpc("portal_attach_order", {
      p_hash: hash,
      p_payment: row.payment_id,
      p_order: order.id,
    });
    if (attachError) throw new Error("attach failed");
    return NextResponse.json({
      keyId: creds.keyId,
      orderId: order.id,
      amountMinor,
      currency: row.currency,
      name: row.org_name,
    });
  } catch (e) {
    await admin.rpc("portal_discard_payment", { p_hash: hash, p_payment: row.payment_id });
    logger.error("portal order failed", { error: e instanceof Error ? e.message : "unknown" });
    return json(502, "Couldn't start the payment. Please try again.");
  }
}
