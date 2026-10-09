import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { uuid } from "@/lib/crm/schemas";
import { buildCreditNotePdfProps } from "@/lib/invoicing/pdf-data";
import { GstDocumentPdf } from "@/lib/pdf/gst-pdf";

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
  if (!(await rateLimit(`credit-pdf:${session.userId}`, 30, 60_000)).allowed)
    return json(429, "Too many requests.");
  try {
    const built = await buildCreditNotePdfProps(id);
    if (!built) return json(404, "Not found."); // missing or another organization (RLS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdf = await renderToBuffer(createElement(GstDocumentPdf, built.props) as any);
    await audit(await createClient(), "DOWNLOAD", "credit_note", id, { number: built.number });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${built.number.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("credit note pdf failed", { error });
    return json(500, "Could not generate the credit note.");
  }
}
