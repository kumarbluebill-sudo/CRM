import { createHmac, timingSafeEqual } from "node:crypto";

/** Rupees (or any 2-decimal currency) to the integer minor unit Razorpay expects, without float drift. */
export function toMinorUnits(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100);
}

/**
 * Verifies the X-Razorpay-Signature header: HMAC-SHA256 of the RAW request body with the webhook secret,
 * compared in constant time. The body must be the exact bytes received (never re-serialised JSON).
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type RazorpayEvent = {
  type: string;
  orderId: string | null;
  paymentId: string | null;
  amount: number | null;
  currency: string | null;
};

/** Extracts only the fields we use from a webhook payload; returns null for anything malformed. */
export function parseWebhookPayload(raw: string): RazorpayEvent | null {
  try {
    const body = JSON.parse(raw) as {
      event?: unknown;
      payload?: {
        payment?: { entity?: Record<string, unknown> };
        order?: { entity?: Record<string, unknown> };
      };
    };
    if (typeof body.event !== "string" || body.event.length > 100) return null;
    const pay = body.payload?.payment?.entity;
    const ord = body.payload?.order?.entity;
    const str = (v: unknown) => (typeof v === "string" && v.length <= 100 ? v : null);
    const num = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
    return {
      type: body.event,
      orderId: str(pay?.order_id) ?? str(ord?.id),
      paymentId: str(pay?.id),
      amount: num(pay?.amount) ?? num(ord?.amount_paid),
      currency: str(pay?.currency) ?? str(ord?.currency),
    };
  } catch {
    return null;
  }
}

export class RazorpayError extends Error {}

/** Creates an order for an amount WE computed from the database (never from the browser). */
export async function createRazorpayOrder(input: {
  keyId: string;
  keySecret: string;
  amountMinor: number;
  currency: string;
  receipt: string;
}): Promise<{ id: string }> {
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${input.keyId}:${input.keySecret}`).toString("base64")}`,
    },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt.slice(0, 40),
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new RazorpayError(`Razorpay order failed (${res.status})`);
  const data = (await res.json()) as { id?: unknown };
  if (typeof data.id !== "string" || !/^order_[A-Za-z0-9]+$/.test(data.id))
    throw new RazorpayError("Razorpay returned an unexpected response");
  return { id: data.id };
}

const basicAuth = (keyId: string, keySecret: string) =>
  `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

/** Creates a subscription to a Razorpay plan. Returns the id and the hosted page where the customer authorises it. */
export async function createRazorpaySubscription(input: {
  keyId: string;
  keySecret: string;
  planId: string;
  organizationId: string;
}): Promise<{ id: string; shortUrl: string }> {
  const res = await fetch("https://api.razorpay.com/v1/subscriptions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: basicAuth(input.keyId, input.keySecret),
    },
    body: JSON.stringify({
      plan_id: input.planId,
      total_count: 120,
      customer_notify: 1,
      notes: { organization_id: input.organizationId },
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new RazorpayError(`Razorpay subscription failed (${res.status})`);
  const data = (await res.json()) as { id?: unknown; short_url?: unknown };
  const url = typeof data.short_url === "string" ? safeHttpsUrl(data.short_url) : null;
  if (typeof data.id !== "string" || !/^sub_[A-Za-z0-9]+$/.test(data.id) || !url)
    throw new RazorpayError("Razorpay returned an unexpected response");
  return { id: data.id, shortUrl: url };
}

export async function cancelRazorpaySubscription(input: {
  keyId: string;
  keySecret: string;
  subscriptionId: string;
}): Promise<void> {
  if (!/^sub_[A-Za-z0-9]+$/.test(input.subscriptionId))
    throw new RazorpayError("Invalid subscription id");
  const res = await fetch(
    `https://api.razorpay.com/v1/subscriptions/${input.subscriptionId}/cancel`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: basicAuth(input.keyId, input.keySecret),
      },
      body: JSON.stringify({ cancel_at_cycle_end: 1 }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    },
  );
  if (!res.ok) throw new RazorpayError(`Razorpay cancel failed (${res.status})`);
}

/** Refunds a captured subscription payment at the gateway (amount in paise). */
export async function refundRazorpayPayment(input: {
  keyId: string;
  keySecret: string;
  paymentId: string;
  amountPaise: number;
}): Promise<void> {
  if (!/^pay_[A-Za-z0-9]+$/.test(input.paymentId)) throw new RazorpayError("Invalid payment id");
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0)
    throw new RazorpayError("Invalid refund amount");
  const res = await fetch(`https://api.razorpay.com/v1/payments/${input.paymentId}/refund`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: basicAuth(input.keyId, input.keySecret),
    },
    body: JSON.stringify({ amount: input.amountPaise }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new RazorpayError(`Razorpay refund failed (${res.status})`);
}

/**
 * Moves a live subscription to another plan: an upgrade applies now, a downgrade at the end of the paid cycle.
 * The plan id comes from our database, never from the browser.
 */
export async function changeRazorpaySubscriptionPlan(input: {
  keyId: string;
  keySecret: string;
  subscriptionId: string;
  planId: string;
  when: "now" | "cycle_end";
}): Promise<void> {
  if (!/^sub_[A-Za-z0-9]+$/.test(input.subscriptionId))
    throw new RazorpayError("Invalid subscription id");
  if (!/^plan_[A-Za-z0-9]+$/.test(input.planId)) throw new RazorpayError("Invalid plan id");
  const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${input.subscriptionId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: basicAuth(input.keyId, input.keySecret),
    },
    body: JSON.stringify({ plan_id: input.planId, schedule_change_at: input.when }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new RazorpayError(`Razorpay plan change failed (${res.status})`);
}

/** Only https URLs are ever handed to the browser as a redirect target. */
export function safeHttpsUrl(v: string): string | null {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname.length > 3 ? u.toString() : null;
  } catch {
    return null;
  }
}

export type SubscriptionEvent = {
  type: string;
  subscriptionId: string | null;
  planId: string | null;
  periodEnd: number | null;
  /** From the payment object that charge and failure events carry. */
  payment: { id: string; amount: number; currency: string; status: string } | null;
};

/** Extracts only what we use from a subscription.* webhook; null if it isn't one or is malformed. */
export function parseSubscriptionEvent(raw: string): SubscriptionEvent | null {
  try {
    const body = JSON.parse(raw) as {
      event?: unknown;
      payload?: {
        subscription?: { entity?: Record<string, unknown> };
        payment?: { entity?: Record<string, unknown> };
      };
    };
    if (typeof body.event !== "string" || !body.event.startsWith("subscription.")) return null;
    const e = body.payload?.subscription?.entity;
    const str = (v: unknown) => (typeof v === "string" && v.length <= 100 ? v : null);
    return {
      type: body.event.slice(0, 100),
      subscriptionId: str(e?.id),
      planId: str(e?.plan_id),
      periodEnd:
        typeof e?.current_end === "number" && Number.isSafeInteger(e.current_end)
          ? e.current_end
          : null,
      payment: (() => {
        const pe = body.payload?.payment?.entity;
        const id = str(pe?.id);
        if (!pe || !id || !/^[A-Za-z0-9_]{3,60}$/.test(id)) return null;
        const amount = pe.amount;
        if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) return null;
        return {
          id,
          amount,
          currency: typeof pe.currency === "string" ? pe.currency.slice(0, 3).toUpperCase() : "INR",
          status: typeof pe.status === "string" ? pe.status.slice(0, 20) : "",
        };
      })(),
    };
  } catch {
    return null;
  }
}

/** Confirms a key pair is valid by making one harmless read-only call. Never logs or returns the secret. */
export async function verifyRazorpayCredentials(
  keyId: string,
  keySecret: string,
): Promise<boolean> {
  try {
    const res = await fetch("https://api.razorpay.com/v1/orders?count=1", {
      headers: { authorization: basicAuth(keyId, keySecret) },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
