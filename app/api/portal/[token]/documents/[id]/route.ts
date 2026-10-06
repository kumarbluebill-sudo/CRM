import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuid } from "@/lib/crm/schemas";
import { clientIp } from "@/lib/portal/queries";
import { hashPortalToken, isPortalToken } from "@/lib/portal/token";
import { rateLimit } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
const json = (status: number, error: string) => NextResponse.json({ error }, { status });

/** Customer document download: the link must own a booking that has this document flagged as shared. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await ctx.params;
  if (!isPortalToken(token) || !uuid.safeParse(id).success) return json(404, "Not found.");
  const ip = await clientIp();
  if (!(await rateLimit(`portal-doc:${ip}`, 30, 60_000)).allowed)
    return json(429, "Too many requests.");
  const admin = createAdminClient();
  if (!admin) return json(503, "Downloads aren't available right now.");
  const { data, error } = await admin.rpc("portal_document", {
    p_hash: hashPortalToken(token),
    p_doc: id,
  });
  const doc = (data as { storage_path: string; name: string }[] | null)?.[0];
  if (error || !doc) return json(404, "Not found.");
  try {
    const url = await getStorage().signedUrl(doc.storage_path, 60, doc.name);
    return NextResponse.redirect(url, {
      status: 302,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (e) {
    logger.error("portal document sign failed", {
      error: e instanceof Error ? e.message : "unknown",
    });
    return json(502, "Could not prepare the download.");
  }
}
