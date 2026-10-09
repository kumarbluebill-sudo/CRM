import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { uuid } from "@/lib/crm/schemas";
import { buildPackageDocument } from "@/lib/packages/document";
import { readStoredImage } from "@/lib/packages/images";
import { getPackageBundle } from "@/lib/packages/queries";
import { PackagePdf } from "@/lib/pdf/package-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;
const json = (status: number, error: string) => NextResponse.json({ error }, { status });

/** Builds the package brochure. Photos are read server-side from private storage and embedded; nothing is hotlinked. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) return json(404, "Not found.");
  const session = await getSessionContext();
  if (!session) return json(401, "Please sign in.");
  if (!session.organization || !session.permissions.has("itineraries.view"))
    return json(403, "Forbidden.");
  if (!(await rateLimit(`pkg-pdf:${session.userId}`, 20, 60_000)).allowed)
    return json(429, "Too many requests.");
  try {
    const bundle = await getPackageBundle(id);
    if (!bundle) return json(404, "Not found."); // missing or another organization (RLS)
    const doc = buildPackageDocument(bundle, session.organization.name);
    const wanted = new Set(
      [
        doc.coverId,
        ...doc.galleryIds,
        ...doc.hotelIds,
        ...doc.days.flatMap((d) => d.imageIds),
      ].filter(Boolean) as string[],
    );
    const supabase = await createClient();
    const images: Record<string, string> = {};
    if (wanted.size > 0) {
      const { data: rows } = await supabase
        .from("package_images")
        .select("id, storage_path")
        .in("id", [...wanted]);
      await Promise.all(
        (rows ?? []).map(async (r) => {
          try {
            images[r.id as string] =
              `data:image/jpeg;base64,${(await readStoredImage(r.storage_path as string)).toString("base64")}`;
          } catch (e) {
            logger.warn("package pdf image skipped", {
              error: e instanceof Error ? e.message : "unknown",
            });
          }
        }),
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdf = await renderToBuffer(createElement(PackagePdf, { doc, images }) as any);
    await audit(supabase, "DOWNLOAD", "package_pdf", id, {
      template: bundle.templateKey,
      photos: Object.keys(images).length,
    });
    const safe = (doc.title || "package").replace(/[^A-Za-z0-9-]+/g, "_").slice(0, 60);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${safe}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("package pdf failed", { error });
    return json(500, "Could not generate the package document.");
  }
}
