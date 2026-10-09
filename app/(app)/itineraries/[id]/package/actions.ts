"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { rateLimit } from "@/lib/rate-limit";
import { formObject, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { getStorage } from "@/lib/storage";
import { TEMPLATE_KEYS, type TemplateKey } from "@/lib/packages/templates";
import { packageDetailsSchema, toDetailsPayload } from "@/lib/packages/schema";

async function guard(key: string, limit = 40) {
  const session = await requirePermission("itineraries.update");
  if (!(await rateLimit(`${key}:${session.userId}`, limit, 60_000)).allowed)
    throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
  return session;
}
const studio = (id: string) => `/itineraries/${id}/package`;

export async function savePackageDetailsAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Package not found." };
  const parsed = packageDetailsSchema.safeParse(formObject(formData));
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  return runAction(async () => {
    await guard("pkg-details");
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_package_details", {
      p_id: id,
      p: toDetailsPayload(parsed.data),
    });
    throwIfDbError(error, "save package details");
    revalidatePath(studio(id));
    return { ok: true, message: "Package details saved." };
  });
}

/** Picks a template. Existing details stay; the template's own colours apply until staff override them. */
export async function selectTemplateAction(id: string, key: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Package not found." };
  if (!(TEMPLATE_KEYS as readonly string[]).includes(key)) return { message: "Unknown template." };
  return runAction(async () => {
    await guard("pkg-template");
    const supabase = await createClient();
    const { data: cur } = await supabase
      .from("package_details")
      .select("*")
      .eq("itinerary_id", id)
      .maybeSingle();
    const c = (cur ?? {}) as Record<string, unknown>;
    const { error } = await supabase.rpc("save_package_details", {
      p_id: id,
      p: {
        templateKey: key as TemplateKey,
        theme: {}, // a new template starts from its own palette
        returnDate: c.return_date ?? null,
        hotelCategory: c.hotel_category ?? null,
        accommodation: c.accommodation ?? null,
        transport: c.transport ?? null,
        flights: c.flights ?? null,
        meals: c.meals ?? null,
        activities: c.activities ?? null,
        price: c.price ?? null,
        currency: c.currency ?? "INR",
        priceNote: c.price_note ?? null,
        childPrice: c.child_price ?? null,
        extraPersonPrice: c.extra_person_price ?? null,
        cancellationPolicy: c.cancellation_policy ?? null,
        terms: c.terms ?? null,
        travelNotes: c.travel_notes ?? null,
        ctaText: c.cta_text ?? null,
      },
    });
    throwIfDbError(error, "select package template");
    revalidatePath(studio(id));
    return { ok: true, message: "Template applied." };
  });
}

export async function setPackageStatusAction(id: string, status: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Package not found." };
  if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)) return { message: "Invalid status." };
  return runAction(async () => {
    await guard("pkg-status");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_package_status", { p_id: id, p_status: status });
    throwIfDbError(error, "set package status");
    revalidatePath(studio(id));
    revalidatePath("/itineraries");
    return {
      ok: true,
      message: { DRAFT: "Moved back to draft.", PUBLISHED: "Published.", ARCHIVED: "Archived." }[
        status
      ],
    };
  });
}

export async function linkImageAction(
  itineraryId: string,
  imageId: string,
  role: string,
  dayNumber?: number,
): Promise<FormState> {
  if (!uuid.safeParse(itineraryId).success || !uuid.safeParse(imageId).success)
    return { message: "Not found." };
  if (!["COVER", "GALLERY", "HOTEL", "DAY"].includes(role))
    return { message: "Invalid placement." };
  if ((role === "DAY") !== (dayNumber !== undefined)) return { message: "Choose the day." };
  return runAction(async () => {
    await guard("pkg-link");
    const supabase = await createClient();
    if (role === "COVER")
      await supabase
        .from("package_image_links")
        .delete()
        .eq("itinerary_id", itineraryId)
        .eq("role", "COVER");
    const { count } = await supabase
      .from("package_image_links")
      .select("id", { count: "exact", head: true })
      .eq("itinerary_id", itineraryId)
      .eq("role", role);
    const { error } = await supabase.from("package_image_links").insert({
      itinerary_id: itineraryId,
      image_id: imageId,
      role,
      day_number: dayNumber ?? null,
      position: Math.min((count ?? 0) + 1, 50),
    });
    if (error?.code === "23505")
      throw new AppError("That photo is already placed there.", "DUPLICATE", 409);
    throwIfDbError(error, "link package image");
    revalidatePath(studio(itineraryId));
    return { ok: true, message: "Photo added." };
  });
}

export async function unlinkImageAction(itineraryId: string, linkId: string): Promise<FormState> {
  if (!uuid.safeParse(itineraryId).success || !uuid.safeParse(linkId).success)
    return { message: "Not found." };
  return runAction(async () => {
    await guard("pkg-link");
    const supabase = await createClient();
    const { error } = await supabase
      .from("package_image_links")
      .delete()
      .eq("id", linkId)
      .eq("itinerary_id", itineraryId);
    throwIfDbError(error, "unlink package image");
    revalidatePath(studio(itineraryId));
    return { ok: true, message: "Photo removed from the package." };
  });
}

/** Removes a photo from the library for good (and from every package using it), including the stored file. */
export async function deleteImageAction(itineraryId: string, imageId: string): Promise<FormState> {
  if (!uuid.safeParse(imageId).success) return { message: "Not found." };
  return runAction(async () => {
    const session = await requirePermission("itineraries.delete");
    if (!(await rateLimit(`pkg-image-del:${session.userId}`, 20, 60_000)).allowed)
      throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
    const supabase = await createClient();
    const { data: img } = await supabase
      .from("package_images")
      .select("storage_path")
      .eq("id", imageId)
      .maybeSingle();
    if (!img) throw new AppError("Photo not found.", "NOT_FOUND", 404);
    const { error } = await supabase.from("package_images").delete().eq("id", imageId);
    throwIfDbError(error, "delete package image");
    await getStorage()
      .remove(img.storage_path as string)
      .catch(() => undefined);
    if (uuid.safeParse(itineraryId).success) revalidatePath(studio(itineraryId));
    return { ok: true, message: "Photo deleted." };
  });
}
