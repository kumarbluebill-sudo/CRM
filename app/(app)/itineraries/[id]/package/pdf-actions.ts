"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { rateLimit } from "@/lib/rate-limit";
import { runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { PDF_SECTION_KEYS, PDF_THEME_KEYS } from "@/lib/itinerary-pdf/themes";

const settingsSchema = z.object({
  theme: z.enum(PDF_THEME_KEYS),
  quotationId: z.uuid().nullable(),
  optionId: z.uuid().nullable(),
  coverImageId: z.uuid().nullable(),
  sections: z.object(
    Object.fromEntries(PDF_SECTION_KEYS.map((k) => [k, z.boolean()])) as Record<
      (typeof PDF_SECTION_KEYS)[number],
      z.ZodBoolean
    >,
  ),
});

/** Saves the chosen look, section toggles and quotation/option/cover photo with the package, so they come back next time. */
export async function saveItineraryPdfSettingsAction(id: string, input: unknown): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Itinerary not found." };
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { message: "Those settings are not valid." };
  return runAction(async () => {
    const session = await requirePermission("itinerary_pdf.generate");
    if (!(await rateLimit(`itin-pdf-save:${session.userId}`, 40, 60_000)).allowed)
      throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_itinerary_pdf_settings", { p_id: id, p: parsed.data });
    throwIfDbError(error, "save itinerary pdf settings");
    revalidatePath(`/itineraries/${id}/package`);
    return { ok: true, message: "PDF settings saved." };
  });
}
