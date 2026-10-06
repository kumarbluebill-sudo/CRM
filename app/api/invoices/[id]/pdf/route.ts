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
import { InvoicePdf, type InvoicePdfProps } from "@/lib/pdf/finance-pdf";

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
  if (!(await rateLimit(`invoice-pdf:${session.userId}`, 30, 60_000)).allowed)
    return json(429, "Too many requests.");

  try {
    const supabase = await createClient();
    const { data: inv } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
    if (!inv) return json(404, "Not found."); // missing or other organization (RLS)
    const [{ data: booking }, branding] = await Promise.all([
      supabase
        .from("bookings")
        .select("booking_number, title, paid_amount")
        .eq("id", inv.booking_id as string)
        .maybeSingle(),
      getBranding(),
    ]);
    if (!booking) return json(404, "Not found.");
    const billTo = inv.bill_to as InvoicePdfProps["billTo"];
    const props: InvoicePdfProps = {
      invoiceNumber: inv.invoice_number as string,
      status: inv.status as string,
      issueDate: inv.issue_date as string,
      dueDate: inv.due_date as string | null,
      currency: inv.currency as string,
      total: Number(inv.total_amount),
      paid: Number(booking.paid_amount),
      bookingNumber: booking.booking_number as string,
      tripTitle: booking.title as string,
      billTo,
      lines: (inv.lines as InvoicePdfProps["lines"]).map((l) => ({
        description: String(l.description),
        quantity: Number(l.quantity),
        unitPrice: l.unitPrice == null ? null : Number(l.unitPrice),
      })),
      notes: inv.notes as string | null,
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
    const pdf = await renderToBuffer(createElement(InvoicePdf, props) as any);
    await audit(supabase, "DOWNLOAD", "invoice", id, { invoice: props.invoiceNumber });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${props.invoiceNumber.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("invoice pdf failed", { error });
    return json(500, "Could not generate the invoice.");
  }
}
