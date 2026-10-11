import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { getSessionContext } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { getBranding } from "@/lib/quotation/queries";
import { getTaxProfile } from "@/lib/invoicing/queries";
import { isInvoiceLayout } from "@/lib/invoicing/layouts";
import { GstDocumentPdf, type GstDocProps } from "@/lib/pdf/gst-pdf";

export const runtime = "nodejs";
export const maxDuration = 30;
const json = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * A SAMPLE invoice in the chosen layout, using the agency's own name, logo and colour but made-up customer and amounts,
 * so nobody has to issue a real invoice to see what a layout looks like. It reads no customer or booking data.
 */
export async function GET(req: NextRequest) {
  const layout = req.nextUrl.searchParams.get("layout");
  if (!isInvoiceLayout(layout)) return json(400, "Choose a layout from the list.");
  const session = await getSessionContext();
  if (!session) return json(401, "Please sign in.");
  if (!session.organization || !session.permissions.has("invoicing.manage"))
    return json(403, "Forbidden.");
  if (!(await rateLimit(`invoice-layout-preview:${session.userId}`, 30, 60_000)).allowed)
    return json(429, "Too many requests.");
  try {
    const [branding, profile] = await Promise.all([getBranding(), getTaxProfile()]);
    // an agency that is not GST-registered charges no tax, so its sample shows none either
    const registered = Boolean(profile?.gst_registered);
    const lines = [
      ["Resort stay, 2 nights", 2, 5000, 5],
      ["Airport transfers", 1, 3200, 5],
      ["Sightseeing with guide", 1, 4500, 18],
    ].map(([description, quantity, unitPrice, rate]) => {
      const taxable = Number(quantity) * Number(unitPrice);
      const gst = registered ? Number(rate) : 0;
      const tax = (taxable * gst) / 100;
      return {
        description: String(description),
        sac: "998555",
        quantity: Number(quantity),
        unitPrice: Number(unitPrice),
        rate: gst,
        discount: 0,
        taxable,
        cgst: tax / 2,
        sgst: tax / 2,
        igst: 0,
        total: taxable + tax,
      };
    });
    const subtotal = lines.reduce((t, l) => t + l.taxable, 0);
    const cgst = lines.reduce((t, l) => t + l.cgst, 0);
    const sgst = lines.reduce((t, l) => t + l.sgst, 0);
    const props: GstDocProps = {
      kind: profile?.gst_registered ? "TAX_INVOICE" : "INVOICE",
      number: `${profile?.invoice_prefix ?? "INV"}/26-27/0001`,
      date: new Date().toISOString().slice(0, 10),
      dueDate: null,
      watermark: "SAMPLE",
      primary: branding?.primary_color,
      layout,
      currency: "INR",
      supplier: {
        legalName: profile?.legal_name ?? session.organization.name,
        tradeName: profile?.trade_name ?? null,
        address: profile?.address ?? null,
        gstin: profile?.gst_registered ? profile.gstin : null,
        pan: profile?.pan ?? null,
        stateCode: profile?.state_code ?? null,
        email: branding?.email ?? null,
        phone: branding?.phone ?? null,
        logo: branding?.logo_data ?? null,
      },
      billTo: {
        name: "Sample Customer",
        address: "12 Example Road, Bengaluru",
        email: "customer@example.com",
      },
      placeOfSupply: profile?.state_code ?? null,
      supplyType: registered ? "INTRA" : "NONE",
      reference: "B-2026-0001",
      lines,
      subtotal,
      cgst,
      sgst,
      igst: 0,
      rounding: 0,
      total: subtotal + cgst + sgst,
      payment: null,
      bank: profile?.bank_account_no
        ? {
            name: profile.bank_name,
            accountName: profile.bank_account_name,
            accountNo: profile.bank_account_no,
            ifsc: profile.bank_ifsc,
            upi: profile.upi_id,
          }
        : null,
      notes: "This is a sample to preview the layout. No invoice was created.",
      terms: profile?.terms ?? null,
      signature: profile?.signature_data ?? null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdf = await renderToBuffer(createElement(GstDocumentPdf, props) as any);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="sample-${layout}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("layout preview failed", { error });
    return json(500, "Could not create the preview.");
  }
}
