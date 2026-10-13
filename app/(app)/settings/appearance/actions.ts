"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { checkThemeInput } from "@/lib/theme/validate";

/** Saves the agency's default theme. `null` clears it (back to the look that ships with the app). */
export async function saveOrgThemeAction(raw: unknown): Promise<FormState> {
  let value: unknown = null;
  if (raw !== null) {
    const checked = checkThemeInput(raw);
    if (!checked.ok) return { message: checked.message };
    value = checked.theme;
  }
  return runAction(async () => {
    await requirePermission("settings.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_org_theme", { p: value });
    throwIfDbError(error, "save agency theme");
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: value ? "Agency theme applied." : "Agency theme reset to the default.",
    };
  });
}
