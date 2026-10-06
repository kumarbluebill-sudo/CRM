import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { uuid } from "@/lib/crm/schemas";
import { getBranding, getQuotationDocument } from "@/lib/quotation/queries";
import { QuotationPdf, type PdfItinerary, type PdfQuotation } from "@/lib/pdf/quotation-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

const json = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) return json(404, "Not found.");

  const session = await getSessionContext();
  if (!session) return json(401, "Please sign in.");
  if (!session.organization || !session.permissions.has("quotes.view"))
    return json(403, "Forbidden.");

  const limit = (await rateLimit(`quote-pdf:${session.userId}`, 20, 60_000));
  if (!limit.allowed) return json(429, "Too many requests. Please wait a moment.");

  try {
    // priv = false: the PDF is built from data that cannot contain supplier costs or profit.
    const doc = await getQuotationDocument(id, false);
    if (!doc) return json(404, "Not found."); // missing or another organization's (RLS)

    const supabase = await createClient();
    const [{ data: customer }, branding, itinerary] = await Promise.all([
      supabase
        .from("customers")
        .select("name, phone, email")
        .eq("id", doc.customerId as string)
        .maybeSingle(),
      getBranding(),
      doc.itineraryId
        ? supabase
            .rpc("itinerary_document", { p_id: doc.itineraryId as string })
            .then((r) => r.data as PdfItinerary)
        : Promise.resolve(null),
    ]);

    const element = createElement(QuotationPdf, {
      quotation: doc as unknown as PdfQuotation,
      customer: {
        name: customer?.name ?? "Customer",
        phone: customer?.phone,
        email: customer?.email,
      },
      itinerary: itinerary ?? null,
      branding: {
        orgName: session.organization.name,
        logo: branding?.logo_data,
        primary: branding?.primary_color,
        secondary: branding?.secondary_color,
        accent: branding?.accent_color,
        phone: branding?.phone,
        whatsapp: branding?.whatsapp,
        email: branding?.email,
        website: branding?.website,
        address: branding?.address,
        gst: branding?.gst_number,
        facebook: branding?.facebook_url,
        instagram: branding?.instagram_url,
        youtube: branding?.youtube_url,
        footer: branding?.footer_text,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdf = await renderToBuffer(element as any);

    const filename = `${String(doc.number).replace(/[^A-Za-z0-9-]/g, "_")}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("quotation pdf failed", { error });
    return json(500, "Could not generate the PDF.");
  }
}
