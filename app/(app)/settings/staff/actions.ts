"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { rateLimit } from "@/lib/rate-limit";
import { formObject, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { staffSchema } from "@/lib/jobs/schema";

export async function saveStaffAction(
  userId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(userId).success) return { message: "Staff member not found." };
  const parsed = staffSchema.safeParse(formObject(formData));
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  return runAction(async () => {
    const session = await requirePermission("users.manage");
    if (!(await rateLimit(`staff-save:${session.userId}`, 40, 60_000)).allowed)
      throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_staff_profile", { p_user: userId, p: parsed.data });
    if (error?.code === "23505")
      throw new AppError("That employee code is already used by someone else.", "DUPLICATE", 409);
    if (error?.code === "22023")
      throw new AppError("That reporting manager isn't valid.", "INVALID_VALUE", 400);
    throwIfDbError(error, "save staff profile");
    revalidatePath("/settings/staff");
    revalidatePath("/jobs");
    return { ok: true, message: "Staff details saved." };
  });
}
