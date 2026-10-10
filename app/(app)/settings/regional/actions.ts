"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { formObject, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { DATE_FORMATS, isValidTimeZone } from "@/lib/datetime/format";

const tz = z.string().refine(isValidTimeZone, "Choose a time zone from the list");

const regionalSchema = z.object({
  timezone: tz,
  dateFormat: z.enum(DATE_FORMATS),
  timeFormat: z.enum(["12h", "24h"]),
  weekStart: z.coerce.number().int().min(0).max(6),
});

export async function saveRegionalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = regionalSchema.safeParse(formObject(formData));
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  return runAction(async () => {
    await requirePermission("settings.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_regional_settings", { p: parsed.data });
    throwIfDbError(error, "save regional settings");
    revalidatePath("/", "layout");
    return { ok: true, message: "Regional settings saved." };
  });
}

const branchSchema = z.object({
  name: z.string().trim().min(2, "Enter a branch name").max(80),
  code: z
    .string()
    .trim()
    .max(12)
    .regex(/^[A-Za-z0-9_-]*$/, "Letters, numbers, - and _ only")
    .optional(),
  timezone: tz,
  active: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});

export async function saveBranchAction(
  id: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (id && !uuid.safeParse(id).success) return { message: "Branch not found." };
  const parsed = branchSchema.safeParse(formObject(formData));
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  return runAction(async () => {
    await requirePermission("settings.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_branch", { p_id: id, p: parsed.data });
    if (error?.code === "23505")
      throw new AppError("A branch with that name already exists.", "DUPLICATE", 409);
    throwIfDbError(error, "save branch");
    revalidatePath("/settings/regional");
    return { ok: true, message: id ? "Branch saved." : "Branch added." };
  });
}
