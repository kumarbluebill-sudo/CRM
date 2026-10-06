import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env.server";
import { parseSubscriptionEvent, verifyWebhookSignature } from "@/lib/payments/razorpay";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
const MAX_BODY = 64 * 1024;

/**
 * PLATFORM billing webhook (subscription.* events for the agencies' own subscriptions to this product).
 * Customer payments are NOT handled here: they arrive at /api/webhooks/razorpay/<organizationId>, signed with that
 * agency's own secret, so one agency's credentials can never confirm another's payments.
 * Trusted only after the HMAC over the raw body checks out; de-duplicated by event id inside the database function.
 */
export async function POST(req: NextRequest) {
  const secret = getServerEnv().RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await rateLimit(`rzp-platform-webhook:${ip}`, 300, 60_000)).allowed)
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY)
    return NextResponse.json({ error: "Too large." }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Too large." }, { status: 413 });

  if (!verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature"), secret)) {
    logger.warn("platform webhook: bad signature", { ip });
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const eventId = req.headers.get("x-razorpay-event-id");
  const sub = parseSubscriptionEvent(raw);
  if (!eventId || eventId.length > 100)
    return NextResponse.json({ error: "Malformed event." }, { status: 400 });
  if (!sub) return NextResponse.json({ ok: true, result: "ignored" }); // not a billing event: acknowledge, do nothing

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const { data, error } = await admin.rpc("apply_subscription_event", {
    p_event_id: eventId,
    p_type: sub.type,
    p_sub: sub.subscriptionId,
    p_rzp_plan: sub.planId,
    p_period_end: sub.periodEnd,
  });
  if (error) {
    logger.error("platform webhook: apply failed", { code: error.code });
    return NextResponse.json({ error: "Could not process." }, { status: 500 }); // Razorpay retries
  }
  return NextResponse.json({ ok: true, result: data });
}
