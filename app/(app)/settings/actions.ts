"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { formObject, runAction, throwIfDbError } from "@/lib/crm/action-utils";

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
    const { error } = await supabase
      .from("organization_branding")
      .update({
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
      .eq("organization_id", session.organization!.id);
    throwIfDbError(error, "save branding");
    revalidatePath("/settings/branding");
    return { ok: true, message: "Branding saved." };
  });
}

const MAX_LOGO_BYTES = 300 * 1024;

/** Accepts PNG/JPEG only, checked by file signature, and stores it as a data URI. No remote fetching. */
export async function uploadLogoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { message: "Choose an image to upload." };
  if (file.size > MAX_LOGO_BYTES) return { message: "The logo must be 300 KB or smaller." };
  return runAction(async () => {
    const session = await requirePermission("settings.manage");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!png && !jpg) throw new AppError("The logo must be a PNG or JPEG image.", "INVALID_FILE");
    const data = `data:image/${png ? "png" : "jpeg"};base64,${Buffer.from(bytes).toString("base64")}`;
    const supabase = await createClient();
    const { error } = await supabase
      .from("organization_branding")
      .update({ logo_data: data })
      .eq("organization_id", session.organization!.id);
    throwIfDbError(error, "save logo");
    revalidatePath("/settings/branding");
    return { ok: true, message: "Logo updated." };
  });
}

export async function removeLogoAction(): Promise<FormState> {
  return runAction(async () => {
    const session = await requirePermission("settings.manage");
    const supabase = await createClient();
    const { error } = await supabase
      .from("organization_branding")
      .update({ logo_data: null })
      .eq("organization_id", session.organization!.id);
    throwIfDbError(error, "remove logo");
    revalidatePath("/settings/branding");
    return { ok: true, message: "Logo removed." };
  });
}
