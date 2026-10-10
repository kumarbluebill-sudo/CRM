"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOrgSession } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { formObject, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { DATE_FORMATS, isValidTimeZone } from "@/lib/datetime/format";

const blank = (v: unknown) => (v === "" ? undefined : v);
const schema = z.object({
  timezone: z.preprocess(
    blank,
    z.string().refine(isValidTimeZone, "Choose a time zone from the list").optional(),
  ),
  dateFormat: z.preprocess(blank, z.enum(DATE_FORMATS).optional()),
  timeFormat: z.preprocess(blank, z.enum(["12h", "24h"]).optional()),
  weekStart: z.preprocess(blank, z.coerce.number().int().min(0).max(6).optional()),
});

export async function saveDisplayPrefsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = schema.safeParse(formObject(formData));
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  return runAction(async () => {
    await requireOrgSession();
    const supabase = await createClient();
    const v = parsed.data;
    const { error } = await supabase.rpc("save_display_prefs", {
      p: {
        timezone: v.timezone ?? "",
        dateFormat: v.dateFormat ?? "",
        timeFormat: v.timeFormat ?? "",
        weekStart: v.weekStart === undefined ? "" : String(v.weekStart),
      },
    });
    throwIfDbError(error, "save display preferences");
    revalidatePath("/", "layout");
    return { ok: true, message: "Display settings saved." };
  });
}
