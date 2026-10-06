import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { uuid } from "@/lib/crm/schemas";
import { getBranding } from "@/lib/quotation/queries";
import { ReceiptPdf, type ReceiptPdfProps } from "@/lib/pdf/finance-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;
const json = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) return json(404, "Not found.");

  const session = await getSessionContext();
  if (!session) return json(401, "Please sign in.");
  if (!session.organization || !session.permissions.has("payments.view"))
    return json(403, "Forbidden.");
  if (!(await rateLimit(`receipt-pdf:${session.userId}`, 30, 60_000)).allowed)
    return json(429, "Too many requests.");

  try {
    const supabase = await createClient();
    const { data: pay } = await supabase.from("payments").select("*").eq("id", id).maybeSingle();
    if (!pay) return json(404, "Not found."); // missing or other organization (RLS)
    if (pay.status !== "CAPTURED" || !pay.receipt_number)
      return json(409, "Receipts exist only for completed payments.");
    const [{ data: booking }, branding] = await Promise.all([
      supabase
        .from("bookings")
        .select("booking_number, title, total_amount, paid_amount, customers ( name )")
        .eq("id", pay.booking_id as string)
        .maybeSingle(),
      getBranding(),
    ]);
    if (!booking) return json(404, "Not found.");
    const customer = booking.customers as unknown as { name: string } | null;
    const props: ReceiptPdfProps = {
      receiptNumber: pay.receipt_number as string,
      paidAt: String(pay.paid_at).slice(0, 10),
      amount: Number(pay.amount),
      currency: pay.currency as string,
      method: pay.method as string,
      reference: (pay.reference ?? pay.razorpay_payment_id) as string | null,
      bookingNumber: booking.booking_number as string,
      tripTitle: booking.title as string,
      customerName: customer?.name ?? "Customer",
      bookingTotal: Number(booking.total_amount),
      bookingPaid: Number(booking.paid_amount),
      branding: {
        orgName: session.organization.name,
        logo: branding?.logo_data,
        primary: branding?.primary_color,
        phone: branding?.phone,
        email: branding?.email,
        address: branding?.address,
        footer: branding?.footer_text,
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdf = await renderToBuffer(createElement(ReceiptPdf, props) as any);
    await audit(supabase, "DOWNLOAD", "receipt", id, { receipt: props.receiptNumber });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${props.receiptNumber.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("receipt pdf failed", { error });
    return json(500, "Could not generate the receipt.");
  }
}
