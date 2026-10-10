"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { requireRecentAuth } from "@/lib/auth/recent";
import { audit } from "@/lib/audit";
import { getPublicEnv } from "@/lib/env";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";
import { rateLimit } from "@/lib/rate-limit";
import { formObject, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { ROLES } from "@/lib/permissions";
import { EmailNotConfiguredError, sendEmail } from "@/lib/comms/email";

type DbError = { code?: string; message: string } | null;

function throwTeamError(error: DbError, context: string) {
  switch (error?.code) {
    case "P0002":
      throw new AppError("That invitation or member wasn't found.", "NOT_FOUND", 404);
    case "P0022":
      throw new AppError("That person is already a member.", "CONFLICT", 409);
    case "42501":
      throw new AppError("You can only manage roles below your own.", "FORBIDDEN", 403);
    case "22023":
      throw new AppError("Check the email address and role.", "INVALID_VALUE", 400);
  }
  throwIfDbError(error, context);
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  role: z.enum(ROLES.filter((r) => r !== "OWNER") as [string, ...string[]]),
});

export async function inviteMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = inviteSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  return runAction(async () => {
    const session = await requirePermission("users.manage");
    if (!(await rateLimit(`invite:${session.userId}`, 20, 60 * 60_000)).allowed)
      throw new AppError("Too many invitations. Please try again later.", "RATE_LIMITED", 429);
    const supabase = await createClient();
    const { error } = await supabase.rpc("create_invite", {
      p_email: parsed.data.email,
      p_role: parsed.data.role,
    });
    throwTeamError(error, "create invite");
    revalidatePath("/settings/team");

    // Best effort: tell them by email. The invitation works either way once they sign up or sign in with this address.
    const url = `${getPublicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/register`;
    try {
      await sendEmail({
        to: parsed.data.email,
        subject: `You're invited to join ${session.organization!.name}`,
        text:
          `${session.fullName || "A colleague"} invited you to join ${session.organization!.name} on Smart Travel CRM.\n\n` +
          `Create your account (or sign in) with this email address to accept: ${url}\n\nThe invitation expires in 7 days.`,
        fromName: session.organization!.name,
      });
      return { ok: true, message: "Invitation sent." };
    } catch (e) {
      if (!(e instanceof EmailNotConfiguredError))
        logger.warn("invite email failed", { error: e instanceof Error ? e.name : "unknown" });
      return {
        ok: true,
        message: `Invitation created, but the email couldn't be sent. Ask them to sign up or sign in at ${url} with ${parsed.data.email}.`,
      };
    }
  });
}

export async function revokeInviteAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Not found." };
  return runAction(async () => {
    await requirePermission("users.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_invite", { p_id: id });
    throwTeamError(error, "revoke invite");
    revalidatePath("/settings/team");
    return { ok: true, message: "Invitation revoked." };
  });
}

/** Rank rules (only roles below your own, never yourself) are enforced by row level security, not here. */
export async function changeRoleAction(userId: string, role: string): Promise<FormState> {
  const next = ROLES.find((r) => r === role);
  if (!uuid.safeParse(userId).success || !next || next === "OWNER")
    return { message: "Invalid request." };
  return runAction(async () => {
    const session = await requirePermission("users.manage");
    await requireRecentAuth();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organization_members")
      .update({ role: next })
      .eq("user_id", userId)
      .select("user_id");
    throwTeamError(error, "change role");
    if (!data?.length) throw new AppError("You can't change that member's role.", "FORBIDDEN", 403);
    await audit(supabase, "PERMISSION_CHANGE", "member", userId, {
      role: next,
      by: session.userId,
    });
    revalidatePath("/settings/team");
    return { ok: true, message: "Role updated." };
  });
}

export async function removeMemberAction(userId: string): Promise<FormState> {
  if (!uuid.safeParse(userId).success) return { message: "Invalid request." };
  return runAction(async () => {
    await requirePermission("users.manage");
    await requireRecentAuth();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organization_members")
      .delete()
      .eq("user_id", userId)
      .select("user_id");
    throwTeamError(error, "remove member");
    if (!data?.length) throw new AppError("You can't remove that member.", "FORBIDDEN", 403);
    await audit(supabase, "PERMISSION_CHANGE", "member", userId, { event: "removed" });
    revalidatePath("/settings/team");
    return { ok: true, message: "Member removed." };
  });
}
