"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { rateLimit } from "@/lib/rate-limit";
import { formObject, runAction } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { LogoError, processLogo } from "@/lib/branding/process-logo";
import { throwInvoicingError } from "@/lib/invoicing/errors";
import { taxCodeSchema, taxProfileSchema } from "@/lib/invoicing/schema";

async function guard(key: string, limit = 30) {
  const session = await requirePermission("invoicing.manage");
  if (!(await rateLimit(`${key}:${session.userId}`, limit, 60_000)).allowed)
    throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
  return session;
}

export async function saveTaxProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = taxProfileSchema.safeParse(formObject(formData));
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  return runAction(async () => {
    await guard("tax-profile", 20);
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_tax_profile", { p: parsed.data });
    throwInvoicingError(error, "save tax profile");
    revalidatePath("/settings/invoicing");
    return { ok: true, message: "Invoicing profile saved." };
  });
}

export async function uploadSignatureAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const file = formData.get("signature");
  if (!(file instanceof File) || file.size === 0) return { message: "Choose an image to upload." };
  return runAction(async () => {
    await guard("tax-signature", 10);
    let img;
    try {
      img = await processLogo(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      if (e instanceof LogoError) throw new AppError(e.message, "INVALID_FILE");
      throw e;
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_tax_signature", { p_data: img.dataUri });
    throwInvoicingError(error, "save signature");
    revalidatePath("/settings/invoicing");
    return { ok: true, message: "Signature saved." };
  });
}

export async function removeSignatureAction(): Promise<FormState> {
  return runAction(async () => {
    await guard("tax-signature", 10);
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_tax_signature", { p_data: null });
    throwInvoicingError(error, "remove signature");
    revalidatePath("/settings/invoicing");
    return { ok: true, message: "Signature removed." };
  });
}

export async function saveTaxCodeAction(
  id: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (id && !uuid.safeParse(id).success) return { message: "Tax code not found." };
  const parsed = taxCodeSchema.safeParse(formObject(formData));
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const v = parsed.data;
  return runAction(async () => {
    await guard("tax-code");
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_tax_code", {
      p_id: id,
      p_name: v.name,
      p_sac: v.sacCode ?? null,
      p_rate: v.rate,
      p_treatment: v.treatment,
      p_active: id ? v.active : true,
    });
    throwInvoicingError(error, "save tax code");
    revalidatePath("/settings/invoicing");
    return {
      ok: true,
      message: id
        ? "Saved. If the rate, SAC or treatment changed it needs verifying again."
        : "Added. Verify it before using it on an invoice.",
    };
  });
}

export async function verifyTaxCodeAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Tax code not found." };
  return runAction(async () => {
    await guard("tax-code");
    const supabase = await createClient();
    const { error } = await supabase.rpc("verify_tax_code", { p_id: id });
    throwInvoicingError(error, "verify tax code");
    revalidatePath("/settings/invoicing");
    return { ok: true, message: "Verified." };
  });
}
