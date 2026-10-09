"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgSession } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { rateLimit } from "@/lib/rate-limit";
import { runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { AppError } from "@/lib/utils/errors";
import { NOTIFICATION_TYPES } from "@/lib/notifications/links";

async function guard(key: string, limit = 120) {
  const session = await requireOrgSession();
  if (!(await rateLimit(`${key}:${session.userId}`, limit, 60_000)).allowed)
    throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
}

export async function markNotificationReadAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Not found." };
  return runAction(async () => {
    await guard("notif-read");
    const supabase = await createClient();
    const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
    throwIfDbError(error, "mark notification read");
    revalidatePath("/notifications");
    return { ok: true };
  });
}

export async function markAllNotificationsReadAction(): Promise<FormState> {
  return runAction(async () => {
    await guard("notif-read-all", 30);
    const supabase = await createClient();
    const { error } = await supabase.rpc("mark_all_notifications_read");
    throwIfDbError(error, "mark all notifications read");
    revalidatePath("/notifications");
    return { ok: true, message: "All notifications marked as read." };
  });
}

/** Saves the whole preferences grid: for every type, whether to show it in the app and whether to email it. */
export async function savePreferencesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await guard("notif-prefs", 20);
    const supabase = await createClient();
    for (const type of NOTIFICATION_TYPES) {
      const { error } = await supabase.rpc("set_notification_pref", {
        p_type: type,
        p_in_app: formData.get(`app:${type}`) === "on",
        p_email: formData.get(`email:${type}`) === "on",
      });
      throwIfDbError(error, "save notification preference");
    }
    revalidatePath("/notifications");
    return { ok: true, message: "Preferences saved." };
  });
}
