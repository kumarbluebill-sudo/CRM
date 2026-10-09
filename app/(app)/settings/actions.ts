"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { formObject, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { LogoError, processLogo } from "@/lib/branding/process-logo";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess(blank, s.optional());
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1a73e8");
const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .regex(/^https:\/\/[^\s]+$/i, "Use a full https:// link");
const phone = z
  .string()
  .trim()
  .regex(/^[+0-9 ()-]{5,20}$/, "Enter a valid phone number");

const brandingSchema = z.object({
  legalName: opt(z.string().trim().max(200)),
  tradeName: opt(z.string().trim().max(200)),
  primaryColor: opt(hex),
  secondaryColor: opt(hex),
  accentColor: opt(hex),
  phone: opt(phone),
  whatsapp: opt(phone),
  email: opt(z.string().trim().toLowerCase().email("Enter a valid email")),
  website: opt(httpsUrl),
  address: opt(z.string().trim().max(500)),
  gstNumber: opt(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{5,20}$/, "Enter a valid GST/tax number"),
  ),
  facebookUrl: opt(httpsUrl),
  instagramUrl: opt(httpsUrl),
  youtubeUrl: opt(httpsUrl),
  footerText: opt(z.string().trim().max(500)),
});

export async function saveBrandingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = brandingSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  return runAction(async () => {
    const session = await requirePermission("settings.manage");
    const supabase = await createClient();
    const { data: saved, error } = await supabase
      .from("organization_branding")
      .update({
        legal_name: v.legalName ?? null,
        trade_name: v.tradeName ?? null,
        primary_color: v.primaryColor ?? null,
        secondary_color: v.secondaryColor ?? null,
        accent_color: v.accentColor ?? null,
        phone: v.phone ?? null,
        whatsapp: v.whatsapp ?? null,
        email: v.email ?? null,
        website: v.website ?? null,
        address: v.address ?? null,
        gst_number: v.gstNumber ?? null,
        facebook_url: v.facebookUrl ?? null,
        instagram_url: v.instagramUrl ?? null,
        youtube_url: v.youtubeUrl ?? null,
        footer_text: v.footerText ?? null,
      })
      .eq("organization_id", session.organization!.id)
      .select("organization_id");
    throwIfDbError(error, "save branding");
    if (!saved?.length)
      throw new AppError("Branding could not be saved. Please try again.", "NOT_SAVED");
    revalidatePath("/", "layout");
    return { ok: true, message: "Branding saved." };
  });
}

/**
 * Accepts PNG, JPEG, WebP or a vetted SVG, checked by file signature. The image is validated, resized and re-encoded as a
 * fresh PNG on the server before it is stored, so the original bytes are never kept. No remote fetching.
 */
export async function uploadLogoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { message: "Choose an image to upload." };
  if (file.size > 2 * 1024 * 1024) return { message: "The logo must be 2 MB or smaller." };
  return runAction(async () => {
    const session = await requirePermission("settings.manage");
    let logo;
    try {
      logo = await processLogo(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      if (e instanceof LogoError) throw new AppError(e.message, "INVALID_FILE");
      throw e;
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organization_branding")
      .update({
        logo_data: logo.dataUri,
        logo_width: logo.width,
        logo_height: logo.height,
        logo_updated_at: new Date().toISOString(),
      })
      .eq("organization_id", session.organization!.id)
      .select("organization_id");
    throwIfDbError(error, "save logo");
    if (!data?.length)
      throw new AppError("The logo could not be saved. Please try again.", "NOT_SAVED");
    revalidatePath("/", "layout");
    return { ok: true, message: "Logo updated." };
  });
}

export async function removeLogoAction(): Promise<FormState> {
  return runAction(async () => {
    const session = await requirePermission("settings.manage");
    const supabase = await createClient();
    const { error } = await supabase
      .from("organization_branding")
      .update({ logo_data: null, logo_width: null, logo_height: null, logo_updated_at: null })
      .eq("organization_id", session.organization!.id);
    throwIfDbError(error, "remove logo");
    revalidatePath("/", "layout");
    return { ok: true, message: "Logo removed." };
  });
}
