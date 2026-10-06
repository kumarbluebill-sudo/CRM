import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { uuid } from "@/lib/crm/schemas";
import { getStorage, StorageUnavailableError } from "@/lib/storage";

export const runtime = "nodejs";
const SIGNED_URL_SECONDS = 60;

const json = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * Authorises through RLS (the documents row is only visible to permitted users in the same organization),
 * logs the download, then redirects to a signed URL that expires in 60 seconds. No permanent public URL exists.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) return json(404, "Not found.");

  const session = await getSessionContext();
  if (!session) return json(401, "Please sign in.");
  if (!session.organization || !session.permissions.has("documents.download"))
    return json(403, "Forbidden.");
  if (!(await rateLimit(`doc-download:${session.userId}`, 60, 60_000)).allowed)
    return json(429, "Too many requests.");

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, name, storage_path, category, is_sensitive")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return json(404, "Not found."); // missing, other organization, or no access to sensitive category

  try {
    const url = await getStorage().signedUrl(
      doc.storage_path as string,
      SIGNED_URL_SECONDS,
      doc.name as string,
    );
    await audit(supabase, "DOWNLOAD", "document", id, {
      category: doc.category,
      sensitive: doc.is_sensitive,
    });
    return NextResponse.redirect(url, {
      status: 302,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof StorageUnavailableError)
      return json(503, "Document storage isn't set up yet.");
    logger.error("document signed url failed", { error });
    return json(502, "Could not prepare the download.");
  }
}
