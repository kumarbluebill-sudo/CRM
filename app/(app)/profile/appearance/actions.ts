"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgSession } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { checkThemeInput } from "@/lib/theme/validate";

/** Saves the signed-in person's own theme. `null` clears it so they follow the agency default again. */
export async function saveMyThemeAction(raw: unknown): Promise<FormState> {
  let value: unknown = null;
  if (raw !== null) {
    const checked = checkThemeInput(raw);
    if (!checked.ok) return { message: checked.message };
    value = checked.theme;
  }
  return runAction(async () => {
    await requireOrgSession();
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_my_theme", { p: value });
    throwIfDbError(error, "save personal theme");
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: value ? "Your theme is applied." : "You now follow the agency theme.",
    };
  });
}
