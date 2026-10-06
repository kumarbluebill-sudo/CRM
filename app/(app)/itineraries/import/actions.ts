"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { redirect, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { itineraryDocSchema } from "@/lib/itinerary/schema";
import type { ParsedItinerary } from "@/lib/import/types";

/** Turns a reviewed import into a DRAFT itinerary that still needs human review before publishing. */
export async function convertImportAction(importId: string): Promise<FormState> {
  if (!uuid.safeParse(importId).success) return { message: "Import not found." };
  let newId = "";
  const result = await runAction(async () => {
    await requirePermission("itineraries.create");
    const supabase = await createClient();
    const { data: imp } = await supabase
      .from("itinerary_imports")
      .select("id, status, parsed")
      .eq("id", importId)
      .maybeSingle();
    if (!imp) throw new AppError("Import not found.", "NOT_FOUND", 404);
    if (imp.status !== "REVIEW")
      throw new AppError("This import was already processed.", "CONFLICT", 409);

    const p = imp.parsed as ParsedItinerary;
    // Validate the draft with the same schema every itinerary save uses.
    const doc = itineraryDocSchema.safeParse({
      title: p.title,
      destination: p.destination,
      summary: p.summary,
      startDate: p.startDate,
      adults: p.adults,
      children: p.children,
      inclusions: p.inclusions,
      exclusions: p.exclusions,
      notes: p.notes,
      status: "DRAFT",
      days: p.days.map((d) => ({
        title: d.title,
        description: d.description,
        notes: d.notes,
        items: d.items.map((i) => ({
          type: i.type,
          title: i.title,
          description: i.description,
          location: i.location,
          time: i.time,
          imageUrl: null,
        })),
      })),
    });
    if (!doc.success)
      throw new AppError("The imported content could not be validated.", "INVALID_VALUE");

    const { data: created, error } = await supabase
      .from("itineraries")
      .insert({
        title: doc.data.title,
        destination: doc.data.destination,
        needs_review: true,
        import_id: importId,
      })
      .select("id")
      .single();
    throwIfDbError(error, "create imported itinerary");
    newId = created!.id as string;

    const { error: saveError } = await supabase.rpc("save_itinerary", {
      p_id: newId,
      p_data: doc.data,
      p_expected_version: 1,
      p_snapshot: true,
      p_label: "Imported (unreviewed)",
    });
    if (saveError) {
      await supabase.from("itineraries").delete().eq("id", newId); // no half-created itinerary
      throwIfDbError(saveError, "save imported itinerary");
    }

    // The extracted text is no longer needed once converted.
    await supabase
      .from("itinerary_imports")
      .update({ status: "CONVERTED", itinerary_id: newId, source_text: null })
      .eq("id", importId);
    revalidatePath("/itineraries");
  });
  if (result.message) return result;
  redirect(`/itineraries/${newId}`);
}

export async function discardImportAction(importId: string): Promise<FormState> {
  if (!uuid.safeParse(importId).success) return { message: "Import not found." };
  const result = await runAction(async () => {
    await requirePermission("itineraries.update");
    const supabase = await createClient();
    const { error } = await supabase
      .from("itinerary_imports")
      .delete()
      .eq("id", importId)
      .eq("status", "REVIEW");
    throwIfDbError(error, "discard import");
  });
  if (result.message) return result;
  redirect("/itineraries/import");
}

export async function markReviewedAction(itineraryId: string): Promise<FormState> {
  if (!uuid.safeParse(itineraryId).success) return { message: "Itinerary not found." };
  return runAction(async () => {
    await requirePermission("itineraries.update");
    const supabase = await createClient();
    const { error } = await supabase.rpc("mark_itinerary_reviewed", { p_id: itineraryId });
    if (error?.code === "P0002") throw new AppError("Already reviewed.", "CONFLICT", 409);
    throwIfDbError(error, "mark reviewed");
    revalidatePath(`/itineraries/${itineraryId}`);
    return { ok: true, message: "Marked as reviewed. You can now publish." };
  });
}
