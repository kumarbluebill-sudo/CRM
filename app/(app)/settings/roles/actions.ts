"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { requireRecentAuth } from "@/lib/auth/recent";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { rateLimit } from "@/lib/rate-limit";
import { runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { PERMISSIONS } from "@/lib/permissions";

async function guard(key: string) {
  const session = await requirePermission("users.manage");
  if (!(await rateLimit(`${key}:${session.userId}`, 40, 60_000)).allowed)
    throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
  await requireRecentAuth();
  return session;
}

/** Database errors from the role functions, translated for people. */
function throwRoleError(error: { code?: string; message: string } | null, context: string) {
  if (!error) return;
  const say: Record<string, string> = {
    P0071: "Choose a base role below your own.",
    P0072: "You can only grant permissions you hold yourself.",
    P0073: "Move the people on this role to another role first.",
    P0074: "You can only change people ranked below you, and never yourself.",
    "23505": "A role with that name already exists.",
  };
  if (error.code && say[error.code]) throw new AppError(say[error.code], "ROLE_RULE", 409);
  throwIfDbError(error, context);
}

const roleSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(40),
  description: z.string().trim().max(200).optional(),
  baseRole: z.enum([
    "ADMIN",
    "SALES_MANAGER",
    "SALES_EXECUTIVE",
    "OPERATIONS",
    "ACCOUNTANT",
    "VIEWER",
  ]),
  dataScope: z.enum(["own", "assigned", "branch", "all"]),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
});

export async function saveRoleAction(id: string | null, input: unknown): Promise<FormState> {
  if (id && !uuid.safeParse(id).success) return { message: "Role not found." };
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success)
    return { message: parsed.error.issues[0]?.message ?? "Check the role details." };
  return runAction(async () => {
    await guard("role-save");
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_org_role", { p_id: id, p: parsed.data });
    throwRoleError(error, "save role");
    revalidatePath("/settings/roles");
    return { ok: true, message: id ? "Role saved." : "Role created." };
  });
}

export async function deleteRoleAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Role not found." };
  return runAction(async () => {
    await guard("role-delete");
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_org_role", { p_id: id });
    throwRoleError(error, "delete role");
    revalidatePath("/settings/roles");
    return { ok: true, message: "Role deleted." };
  });
}

export async function assignRoleAction(userId: string, roleId: string | null): Promise<FormState> {
  if (!uuid.safeParse(userId).success || (roleId !== null && !uuid.safeParse(roleId).success))
    return { message: "Invalid request." };
  return runAction(async () => {
    await guard("role-assign");
    const supabase = await createClient();
    const { error } = await supabase.rpc("assign_org_role", { p_user: userId, p_role: roleId });
    throwRoleError(error, "assign role");
    revalidatePath("/settings/roles");
    return { ok: true, message: "Access updated." };
  });
}

export async function setBranchAction(userId: string, branchId: string | null): Promise<FormState> {
  if (!uuid.safeParse(userId).success || (branchId !== null && !uuid.safeParse(branchId).success))
    return { message: "Invalid request." };
  return runAction(async () => {
    await requirePermission("users.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_member_branch", {
      p_user: userId,
      p_branch: branchId,
    });
    throwRoleError(error, "set branch");
    revalidatePath("/settings/roles");
    return { ok: true, message: "Branch updated." };
  });
}

export async function setAssignmentLimitAction(
  userId: string,
  max: number | null,
): Promise<FormState> {
  if (
    !uuid.safeParse(userId).success ||
    (max !== null && !(Number.isInteger(max) && max >= 1 && max <= 500))
  )
    return { message: "Enter a whole number from 1 to 500, or leave it empty." };
  return runAction(async () => {
    await requirePermission("users.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_assignment_limit", { p_user: userId, p_max: max });
    throwRoleError(error, "save assignment limit");
    revalidatePath("/settings/roles");
    return { ok: true, message: "Limit saved." };
  });
}
