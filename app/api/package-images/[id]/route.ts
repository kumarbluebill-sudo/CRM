import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { uuid } from "@/lib/crm/schemas";
import { readStoredImage } from "@/lib/packages/images";

export const runtime = "nodejs";
const json = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * Serves one library photo to a signed-in member of the same agency. Access is decided by row security on the image row;
 * the storage URL is never exposed, and the response is private (not cached by shared caches).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) return json(404, "Not found.");
  const session = await getSessionContext();
  if (!session) return json(401, "Please sign in.");
  if (!session.organization || !session.permissions.has("itineraries.view"))
    return json(403, "Forbidden.");
  if (!(await rateLimit(`pkg-image-get:${session.userId}`, 600, 60_000)).allowed)
    return json(429, "Too many requests.");
  const supabase = await createClient();
  const { data } = await supabase
    .from("package_images")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!data) return json(404, "Not found.");
  try {
    const bytes = await readStoredImage(data.storage_path as string);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
      },
    });
  } catch (error) {
    logger.error("package image read failed", { error });
    return json(502, "Could not load the photo.");
  }
}
