import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { uuid } from "@/lib/crm/schemas";
import { BillingReceiptPdf } from "@/lib/pdf/billing-receipt-pdf";

export const runtime = "nodejs";
export const maxDuration = 30;
const json = (status: number, error: string) => NextResponse.json({ error }, { status });

type Receipt = {
  number: string;
  amountPaise: number;
  currency: string;
  plan: string;
  periodEnd: string | null;
  issuedAt: string;
  organization: string;
};

/** A subscription payment receipt as PDF. Only people who manage billing in the owning agency can open it. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) return json(404, "Not found.");
  const session = await getSessionContext();
  if (!session) return json(401, "Please sign in.");
  if (!session.organization || !session.permissions.has("billing.manage"))
    return json(403, "Forbidden.");
  if (!(await rateLimit(`billing-receipt:${session.userId}`, 20, 60_000)).allowed)
    return json(429, "Too many requests.");
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("billing_receipt", { p_id: id });
    if (error?.code === "P0002") return json(404, "Not found.");
    if (error || !data) throw error ?? new Error("no receipt");
    const r = data as Receipt;
    const money = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: r.currency,
    }).format(r.amountPaise / 100);
    const day = (v: string | null) => (v ? v.slice(0, 10) : null);
    const pdf = await renderToBuffer(
      createElement(BillingReceiptPdf, {
        number: r.number,
        organization: r.organization,
        plan: r.plan,
        amount: money,
        issuedOn: day(r.issuedAt)!,
        periodEnd: day(r.periodEnd),
      }) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    await audit(supabase, "DOWNLOAD", "billing_receipt", id, { receipt: r.number });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${r.number.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    logger.error("receipt pdf failed", { error: e instanceof Error ? e.message : "unknown" });
    return json(500, "Could not create the receipt.");
  }
}
