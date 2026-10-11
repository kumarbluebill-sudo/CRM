"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/session";
import { requireRecentAuth } from "@/lib/auth/recent";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { formObject, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { rateLimit } from "@/lib/rate-limit";
import { getBackupConfig, runBackup, verifyStoredBackup } from "@/lib/backup/run";

const settingsSchema = z.object({
  enabled: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  frequency: z.enum(["DAILY", "WEEKLY"]),
  retentionDays: z.coerce.number().int().min(7, "At least 7 days").max(365, "At most 365 days"),
  keepMin: z.coerce.number().int().min(1, "At least 1").max(30, "At most 30"),
});

export async function saveBackupSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = settingsSchema.safeParse(formObject(formData));
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  return runAction(async () => {
    await requirePermission("backup.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_backup_settings", {
      p_enabled: parsed.data.enabled,
      p_frequency: parsed.data.frequency,
      p_retention_days: parsed.data.retentionDays,
      p_keep_min: parsed.data.keepMin,
    });
    throwIfDbError(error, "save backup settings");
    revalidatePath("/settings/backups");
    return { ok: true, message: "Backup settings saved." };
  });
}

function configOrThrow() {
  const cfg = getBackupConfig();
  if ("missing" in cfg)
    throw new AppError(`${cfg.missing} Ask your administrator.`, "NOT_CONFIGURED", 503);
  return cfg;
}

async function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) throw new AppError("Backups aren't available right now.", "NOT_CONFIGURED", 503);
  return admin;
}

export async function runBackupNowAction(): Promise<FormState> {
  return runAction(async () => {
    const session = await requirePermission("backup.manage");
    if (!(await rateLimit(`backup:${session.userId}`, 3, 10 * 60_000)).allowed)
      throw new AppError("Please wait a few minutes before another backup.", "RATE_LIMITED", 429);
    const cfg = configOrThrow();
    const admin = await adminOrThrow();
    const supabase = await createClient();
    await supabase.rpc("write_audit", {
      p_action: "EXPORT",
      p_entity_type: "backup_runs",
      p_metadata: { event: "BACKUP_RUN_REQUESTED" },
    });
    const r = await runBackup(admin, cfg, {
      orgId: session.organization!.id,
      kind: "MANUAL",
      userId: session.userId,
    });
    revalidatePath("/settings/backups");
    if (!r.ok) return { message: r.error ?? "The backup failed." };
    return { ok: true, message: "Backup completed and verified." };
  });
}

export async function verifyBackupAction(runId: string): Promise<FormState> {
  return runAction(async () => {
    const session = await requirePermission("backup.manage");
    const id = uuid.parse(runId);
    const supabase = await createClient();
    // RLS: only a run of this agency is visible
    const { data: own } = await supabase
      .from("backup_runs")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!own || !session.organization)
      throw new AppError("That backup wasn't found.", "NOT_FOUND", 404);
    const r = await verifyStoredBackup(await adminOrThrow(), configOrThrow(), id);
    revalidatePath("/settings/backups");
    if (!r.ok) return { message: r.error ?? "The check failed." };
    return { ok: true, message: "The stored copy was read back and passed every check." };
  });
}

/**
 * Prepares a restore PLAN. It never changes data. It needs a recent password check, a typed confirmation, and it first
 * takes and verifies a safety snapshot of the current state.
 */
export async function prepareRestorePlanAction(runId: string, confirm: string): Promise<FormState> {
  return runAction(async () => {
    const session = await requirePermission("backup.manage");
    await requireRecentAuth();
    const id = uuid.parse(runId);
    if (confirm.trim() !== "RESTORE")
      throw new AppError("Type RESTORE to confirm.", "CONFIRM_REQUIRED", 400);
    if (!(await rateLimit(`restore:${session.userId}`, 3, 10 * 60_000)).allowed)
      throw new AppError("Please wait a few minutes.", "RATE_LIMITED", 429);
    const cfg = configOrThrow();
    const admin = await adminOrThrow();
    const safety = await runBackup(admin, cfg, {
      orgId: session.organization!.id,
      kind: "PRE_RESTORE",
      userId: session.userId,
    });
    if (!safety.ok)
      throw new AppError(
        `The safety snapshot failed, so no plan was made. ${safety.error ?? ""}`.trim(),
        "SAFETY_FAILED",
        500,
      );
    const supabase = await createClient();
    const { error } = await supabase.rpc("request_restore_plan", {
      p_run: id,
      p_safety: safety.runId,
      p_note: null,
    });
    if (error?.code === "P0090" || error?.code === "P0091")
      throw new AppError(error.message, "NOT_ALLOWED", 409);
    throwIfDbError(error, "restore plan");
    revalidatePath("/settings/backups");
    return {
      ok: true,
      message: "Restore plan prepared. Nothing was changed. Follow the steps shown below.",
    };
  });
}

export async function closeRestorePlanAction(id: string, cancel: boolean): Promise<FormState> {
  return runAction(async () => {
    await requirePermission("backup.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("close_restore_plan", {
      p_id: uuid.parse(id),
      p_cancel: cancel,
    });
    throwIfDbError(error, "close restore plan");
    revalidatePath("/settings/backups");
    return { ok: true, message: cancel ? "Restore plan cancelled." : "Restore plan closed." };
  });
}
