import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getPublicEnv } from "@/lib/env";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { uuid } from "@/lib/crm/schemas";
import { getStorage, StorageUnavailableError } from "@/lib/storage";
import { whatsappLink } from "@/lib/comms/templates";
import { renderItineraryPdf } from "@/lib/itinerary-pdf/render";

export const runtime = "nodejs";
export const maxDuration = 60;
const json = (status: number, error: string) => NextResponse.json({ error }, { status });
const choice = z.object({ quotation: z.uuid().optional(), option: z.uuid().optional() });
/** The generated file may be larger than an upload; the documents table allows up to 10 MB. */
const MAX_STORED_BYTES = 10 * 1024 * 1024;
const SIGNED_LINK_SECONDS = 7 * 24 * 3600;

async function guard(id: string, write: boolean) {
  if (!uuid.safeParse(id).success) return { error: json(404, "Not found.") };
  const session = await getSessionContext();
  if (!session) return { error: json(401, "Please sign in.") };
  const need = ["itinerary_pdf.generate", "itineraries.view", ...(write ? ["documents.upload"] : [])];
  if (!session.organization || need.some((p) => !session.permissions.has(p)))
    return { error: json(403, "Forbidden.") };
  if (!(await rateLimit(`itin-pdf:${session.userId}`, write ? 10 : 20, 60_000)).allowed)
    return { error: json(429, "Too many requests.") };
  return { session };
}

/** Downloads the itinerary PDF. The quotation and option query values override the saved choice (used by the quotation page). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id, false);
  if ("error" in g) return g.error;
  const q = choice.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) return json(400, "Invalid request.");
  try {
    const out = await renderItineraryPdf(id, g.session.organization!.name, {
      quotationId: q.data.quotation,
      optionId: q.data.option,
    });
    if (!out) return json(404, "Not found."); // missing or another organization (RLS)
    const supabase = await createClient();
    await audit(supabase, "DOWNLOAD", "itinerary_pdf", id, {
      theme: out.model.themeKey,
      pages: out.model.pages.length,
    });
    return new NextResponse(new Uint8Array(out.buffer), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${out.filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("itinerary pdf failed", { error });
    return json(500, "Could not generate the itinerary PDF.");
  }
}

/** Generates the PDF, stores it under Documents, and returns a 7-day signed link plus a ready WhatsApp link. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const origin = req.headers.get("origin");
  if (
    origin &&
    new URL(origin).host !== new URL(getPublicEnv().NEXT_PUBLIC_APP_URL).host &&
    origin !== req.nextUrl.origin
  )
    return json(403, "Forbidden.");
  const { id } = await ctx.params;
  const g = await guard(id, true);
  if ("error" in g) return g.error;
  let path = "";
  try {
    const out = await renderItineraryPdf(id, g.session.organization!.name);
    if (!out) return json(404, "Not found.");
    if (out.buffer.length > MAX_STORED_BYTES)
      return json(413, "The PDF is larger than 10 MB. Remove some photos.");
    const storage = getStorage();
    path = `${g.session.organization!.id}/${randomUUID()}.pdf`;
    await storage.put(path, new Uint8Array(out.buffer), "application/pdf");
    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from("documents")
      .insert({
        category: "ITINERARY",
        name: out.filename.slice(0, 150),
        storage_path: path,
        mime_type: "application/pdf",
        size_bytes: out.buffer.length,
        sha256: createHash("sha256").update(out.buffer).digest("hex"),
        customer_id: out.data.customerId,
        itinerary_id: id,
        notes: `Generated from Itinerary PDF Studio (${out.model.themeKey}).`,
      })
      .select("id")
      .single();
    if (error || !row) {
      await storage.remove(path).catch(() => undefined);
      logger.error("itinerary pdf document row failed", { error });
      return json(500, "Could not save the PDF.");
    }
    await audit(supabase, "UPLOAD", "itinerary_pdf", id, {
      documentId: row.id,
      theme: out.model.themeKey,
      pages: out.model.pages.length,
    });
    const url = await storage.signedUrl(path, SIGNED_LINK_SECONDS, out.filename);
    const c = out.data.customerContact;
    const digits = (c?.whatsapp || c?.phone || "").replace(/\D/g, "");
    const text = `Hello${c ? ` ${c.name}` : ""}, here is your itinerary for ${out.model.title}: ${url}`;
    return NextResponse.json({
      documentId: row.id,
      filename: out.filename,
      url,
      whatsappUrl: digits ? whatsappLink(digits, text) : null,
    });
  } catch (error) {
    if (path) await getStorage().remove(path).catch(() => undefined);
    if (error instanceof StorageUnavailableError)
      return json(503, "Document storage is not configured.");
    logger.error("itinerary pdf store failed", { error });
    return json(500, "Could not generate the itinerary PDF.");
  }
}
