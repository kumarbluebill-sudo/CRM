import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getPublicEnv } from "@/lib/env";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { getStorage, StorageUnavailableError } from "@/lib/storage";
import {
  ASPECTS,
  FOCUSES,
  ImageError,
  MAX_IMAGE_INPUT_BYTES,
  processPackageImage,
} from "@/lib/packages/images";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });
const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const meta = z.object({
  aspect: z.preprocess(blank, z.enum(ASPECTS as [string, ...string[]]).default("ORIGINAL")),
  focus: z.preprocess(blank, z.enum(FOCUSES as [string, ...string[]]).default("CENTER")),
  alt: z.preprocess(blank, z.string().trim().max(200).optional()),
  rights: z.literal("on", { error: "Confirm that you have the right to use this photo." }),
  itineraryId: z.preprocess(blank, z.string().uuid().optional()),
  role: z.preprocess(blank, z.enum(["COVER", "GALLERY", "HOTEL", "DAY"]).optional()),
  dayNumber: z.preprocess(blank, z.coerce.number().int().min(1).max(60).optional()),
});

/**
 * Uploads one authorised photograph. The type is checked by file signature, the photo is cropped and re-encoded as a JPEG
 * (metadata stripped), stored in the private bucket under the agency's folder, and recorded in the image library.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (
    origin &&
    new URL(origin).host !== new URL(getPublicEnv().NEXT_PUBLIC_APP_URL).host &&
    origin !== request.nextUrl.origin
  )
    return fail(403, "Forbidden.");
  const session = await getSessionContext();
  if (!session) return fail(401, "Please sign in.");
  if (!session.organization || !session.permissions.has("itineraries.update"))
    return fail(403, "You don't have permission to upload package photos.");
  if (!(await rateLimit(`pkg-image:${session.userId}`, 20, 60_000)).allowed)
    return fail(429, "Too many uploads. Please wait a moment.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMAGE_INPUT_BYTES + 64 * 1024)
    return fail(413, "The photo must be 5 MB or smaller.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Invalid upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "Choose a photo to upload.");
  const parsed = meta.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success)
    return fail(400, parsed.error.issues[0]?.message ?? "Check the photo details.");
  const m = parsed.data;
  if (m.role && !m.itineraryId) return fail(400, "Choose the package this photo is for.");
  if ((m.role === "DAY") !== (m.dayNumber !== undefined))
    return fail(400, "A day photo needs its day number.");

  let img;
  try {
    img = await processPackageImage(
      new Uint8Array(await file.arrayBuffer()),
      m.aspect as never,
      m.focus as never,
    );
  } catch (e) {
    if (e instanceof ImageError) return fail(415, e.message);
    logger.error("package image processing failed", { error: e });
    return fail(500, "Could not process the photo.");
  }

  let storage;
  try {
    storage = getStorage();
  } catch (e) {
    if (e instanceof StorageUnavailableError)
      return fail(503, "Storage isn't set up yet. Please contact your administrator.");
    throw e;
  }
  const path = `${session.organization.id}/packages/${randomUUID()}.jpg`;
  try {
    await storage.put(path, new Uint8Array(img.data), "image/jpeg");
  } catch (e) {
    logger.error("package image upload to storage failed", { error: e });
    return fail(502, "Could not store the photo. Please try again.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("package_images")
    .insert({
      storage_path: path,
      name: file.name.replace(/[^\w .()-]/g, "_").slice(0, 150) || "photo.jpg",
      alt: m.alt ?? null,
      width: img.width,
      height: img.height,
      size_bytes: img.data.byteLength,
      rights_confirmed: true,
    })
    .select("id")
    .single();
  if (error || !data) {
    await storage.remove(path).catch(() => undefined);
    logger.warn("package image insert rejected", { code: error?.code });
    return fail(error?.code === "42501" ? 403 : 400, "The photo could not be saved.");
  }
  if (m.role && m.itineraryId) {
    const { count } = await supabase
      .from("package_image_links")
      .select("id", { count: "exact", head: true })
      .eq("itinerary_id", m.itineraryId)
      .eq("role", m.role);
    // a new cover replaces the old cover link (the old photo stays in the library)
    if (m.role === "COVER")
      await supabase
        .from("package_image_links")
        .delete()
        .eq("itinerary_id", m.itineraryId)
        .eq("role", "COVER");
    const { error: linkError } = await supabase.from("package_image_links").insert({
      itinerary_id: m.itineraryId,
      image_id: data.id,
      role: m.role,
      day_number: m.dayNumber ?? null,
      position: Math.min((count ?? 0) + 1, 50),
    });
    if (linkError) {
      logger.warn("package image link rejected", { code: linkError.code });
      return NextResponse.json({
        id: data.id,
        linked: false,
        warning: "The photo was saved but could not be attached.",
      });
    }
  }
  await audit(supabase, "UPLOAD", "package_image", data.id as string, {
    bytes: img.data.byteLength,
  });
  return NextResponse.json({ id: data.id, linked: Boolean(m.role) });
}
