import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuid } from "@/lib/crm/schemas";
import { getOrgRazorpay } from "@/lib/payments/credentials";
import { parseWebhookPayload, verifyWebhookSignature } from "@/lib/payments/razorpay";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
const MAX_BODY = 64 * 1024;

/**
 * Customer-payment webhook for ONE agency. The organization id in the URL selects which agency's webhook secret to
 * verify against, and the database function then only settles payments belonging to that same organization. The URL
 * is not a secret (the signature is), and an unknown or unconfigured organization gets the same 404 as any other path.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  if (!uuid.safeParse(orgId).success)
    return NextResponse.json({ error: "Not found." }, { status: 404 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await rateLimit(`rzp-webhook:${ip}`, 300, 60_000)).allowed)
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY)
    return NextResponse.json({ error: "Too large." }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Too large." }, { status: 413 });

  const creds = await getOrgRazorpay(orgId);
  if (!creds) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature"), creds.webhookSecret)) {
    logger.warn("org webhook: bad signature", { ip });
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const eventId = req.headers.get("x-razorpay-event-id");
  const event = parseWebhookPayload(raw);
  if (!eventId || eventId.length > 100 || !event)
    return NextResponse.json({ error: "Malformed event." }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const { data, error } = await admin.rpc("apply_razorpay_event", {
    p_org: orgId,
    p_event_id: eventId,
    p_event_type: event.type,
    p_order_id: event.orderId,
    p_payment_id: event.paymentId,
    p_amount_paise: event.amount,
    p_currency: event.currency,
  });
  if (error) {
    logger.error("org webhook: apply failed", { code: error.code });
    return NextResponse.json({ error: "Could not process." }, { status: 500 }); // Razorpay will retry
  }
  if (data === "amount_mismatch") logger.error("org webhook: amount mismatch", { eventId });
  return NextResponse.json({ ok: true, result: data });
}
