import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env.server";
import { parseWebhookPayload, verifyWebhookSignature } from "@/lib/payments/razorpay";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
const MAX_BODY = 64 * 1024;

/**
 * Razorpay webhook. Public (no session) but trusted only after the HMAC signature over the raw body checks out.
 * Settlement is done by apply_razorpay_event(), which de-duplicates by event id and verifies amount/currency.
 * Responds 200 for valid-but-ignored events so Razorpay does not retry them; 5xx only for our own failures.
 */
export async function POST(req: NextRequest) {
  const secret = getServerEnv().RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`rzp-webhook:${ip}`, 300, 60_000).allowed)
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return NextResponse.json({ error: "Too large." }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Too large." }, { status: 413 });

  if (!verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature"), secret)) {
    logger.warn("razorpay webhook: bad signature", { ip });
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const eventId = req.headers.get("x-razorpay-event-id");
  const event = parseWebhookPayload(raw);
  if (!eventId || eventId.length > 100 || !event)
    return NextResponse.json({ error: "Malformed event." }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const { data, error } = await admin.rpc("apply_razorpay_event", {
    p_event_id: eventId,
    p_event_type: event.type,
    p_order_id: event.orderId,
    p_payment_id: event.paymentId,
    p_amount_paise: event.amount,
    p_currency: event.currency,
  });
  if (error) {
    logger.error("razorpay webhook: apply failed", { code: error.code });
    return NextResponse.json({ error: "Could not process." }, { status: 500 }); // Razorpay will retry
  }
  if (data === "amount_mismatch") logger.error("razorpay webhook: amount mismatch", { eventId });
  return NextResponse.json({ ok: true, result: data });
}
