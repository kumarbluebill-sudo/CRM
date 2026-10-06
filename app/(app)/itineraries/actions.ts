"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { formObject, redirect, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { itineraryDocSchema } from "@/lib/itinerary/schema";
import { z } from "zod";

type DbError = { code?: string; message: string } | null;

function throwItineraryError(error: DbError, context: string) {
  if (error?.code === "40001") {
    throw new AppError(
      "Someone else changed this itinerary. Reload the page to get the latest version.",
      "CONFLICT",
      409,
    );
  }
  if (error?.code === "P0003") {
    throw new AppError(
      "Imported content must be reviewed before publishing.",
      "REVIEW_REQUIRED",
      409,
    );
  }
  if (error?.code === "P0002") throw new AppError("Itinerary not found.", "NOT_FOUND", 404);
  throwIfDbError(error, context);
}

const createSchema = z.object({
  title: z.string().trim().min(2, "Enter a title").max(200),
  destination: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().trim().max(200).optional(),
  ),
  leadId: z.preprocess((v) => (v === "" ? undefined : v), uuid.optional()),
  templateId: z.preprocess((v) => (v === "" ? undefined : v), uuid.optional()),
  asTemplate: z.preprocess((v) => v === "on", z.boolean()),
});

export async function createItineraryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  let newId = "";
  const result = await runAction(async () => {
    await requirePermission("itineraries.create");
    const supabase = await createClient();

    if (v.templateId) {
      const { data, error } = await supabase.rpc("duplicate_itinerary", {
        p_id: v.templateId,
        p_template: false,
      });
      throwItineraryError(error, "use template");
      newId = data as string;
      const { error: e2 } = await supabase
        .from("itineraries")
        .update({ title: v.title, destination: v.destination ?? null, lead_id: v.leadId ?? null })
        .eq("id", newId);
      throwItineraryError(e2, "name from template");
    } else {
      // Pre-fill from the lead when creating from one. RLS guarantees the lead is ours.
      let customerId: string | null = null;
      let destination = v.destination ?? null;
      if (v.leadId) {
        const { data: lead } = await supabase
          .from("leads")
          .select("customer_id, destination")
          .eq("id", v.leadId)
          .maybeSingle();
        if (!lead) throw new AppError("Lead not found.", "NOT_FOUND", 404);
        customerId = lead.customer_id as string | null;
        destination = destination ?? (lead.destination as string | null);
      }
      const { data, error } = await supabase
        .from("itineraries")
        .insert({
          title: v.title,
          destination,
          lead_id: v.leadId ?? null,
          customer_id: customerId,
          is_template: v.asTemplate,
        })
        .select("id")
        .single();
      throwItineraryError(error, "create itinerary");
      newId = data!.id as string;
    }
    revalidatePath("/itineraries");
  });
  if (result.message) return result;
  redirect(`/itineraries/${newId}`);
}

export async function saveItineraryAction(
  id: string,
  expectedVersion: number,
  payload: unknown,
  options: { snapshot?: boolean; label?: string } = {},
): Promise<{ ok: boolean; message?: string; version?: number; fieldErrors?: string[] }> {
  if (!uuid.safeParse(id).success || !Number.isInteger(expectedVersion)) {
    return { ok: false, message: "Invalid request." };
  }
  const parsed = itineraryDocSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`);
    return {
      ok: false,
      message: "Please fix the highlighted problems.",
      fieldErrors: issues.slice(0, 8),
    };
  }
  let version = 0;
  const res = await runAction(async () => {
    await requirePermission("itineraries.update");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_itinerary", {
      p_id: id,
      p_data: parsed.data,
      p_expected_version: expectedVersion,
      p_snapshot: options.snapshot ?? false,
      p_label: options.label?.slice(0, 100) ?? null,
    });
    throwItineraryError(error, "save itinerary");
    version = data as number;
    revalidatePath("/itineraries");
    revalidatePath(`/itineraries/${id}`);
  });
  return res.message ? { ok: false, message: res.message } : { ok: true, version };
}

export async function duplicateItineraryAction(
  id: string,
  asTemplate: boolean,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Itinerary not found." };
  let newId = "";
  const result = await runAction(async () => {
    await requirePermission("itineraries.create");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("duplicate_itinerary", {
      p_id: id,
      p_template: asTemplate,
    });
    throwItineraryError(error, "duplicate itinerary");
    newId = data as string;
    revalidatePath("/itineraries");
  });
  if (result.message) return result;
  redirect(`/itineraries/${newId}`);
}

export async function deleteItineraryAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Itinerary not found." };
  const result = await runAction(async () => {
    await requirePermission("itineraries.delete");
    const supabase = await createClient();
    const { error } = await supabase.from("itineraries").delete().eq("id", id);
    throwItineraryError(error, "delete itinerary");
    revalidatePath("/itineraries");
  });
  if (result.message) return result;
  redirect("/itineraries");
}
