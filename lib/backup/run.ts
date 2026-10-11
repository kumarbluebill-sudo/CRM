import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/utils/logger";
import {
  buildArchive,
  parseBackupKey,
  sealArchive,
  verifyArchive,
  type ArchiveSource,
} from "./archive";
import { BackupError, backupTargetFromEnv, type BackupTarget } from "./target";

export type BackupKind = "SCHEDULED" | "MANUAL" | "PRE_RESTORE";

export type BackupConfig = { target: BackupTarget; key: Buffer } | { missing: string };

/** Destination and key from the environment, or a plain-language reason it cannot run. */
export function getBackupConfig(): BackupConfig {
  const env = getServerEnv();
  const target = backupTargetFromEnv(env);
  if (!target) return { missing: "No backup destination is configured yet." };
  if (!env.BACKUP_ENCRYPTION_KEY) return { missing: "No backup encryption key is configured yet." };
  try {
    return { target, key: parseBackupKey(env.BACKUP_ENCRYPTION_KEY) };
  } catch {
    return { missing: "The backup encryption key is not valid." };
  }
}

function sourceFor(admin: SupabaseClient, orgId: string): ArchiveSource {
  return {
    async tables() {
      const { data, error } = await admin.rpc("backup_table_list");
      if (error) throw new BackupError("Could not list the data to back up.");
      return data as string[];
    },
    async rows(table, offset, limit) {
      const { data, error } = await admin.rpc("backup_export_rows", {
        p_table: table,
        p_org: orgId,
        p_offset: offset,
        p_limit: limit,
      });
      if (error) throw new BackupError(`Could not read ${table}.`);
      return data as Record<string, unknown>[];
    },
  };
}

export const backupObjectKey = (orgId: string, runId: string, at = new Date()) =>
  `org/${orgId}/${at.getUTCFullYear()}/${runId}.crmbk`;

/**
 * Takes, stores and verifies one backup. The run is recorded as OK only when the stored copy was read back and passed
 * every check; otherwise it is FAILED and the people holding backup.manage are notified (by the database).
 */
export async function runBackup(
  admin: SupabaseClient,
  cfg: { target: BackupTarget; key: Buffer },
  p: { orgId: string; kind: BackupKind; userId?: string | null },
): Promise<{ ok: boolean; runId: string; error?: string }> {
  const { data: runId, error: beginError } = await admin.rpc("backup_begin", {
    p_org: p.orgId,
    p_kind: p.kind,
    p_by: p.userId ?? null,
  });
  if (beginError || !runId) {
    if (beginError?.code === "23505")
      return { ok: false, runId: "", error: "A backup is already running." };
    logger.error("backup could not start", { code: beginError?.code });
    return { ok: false, runId: "", error: "The backup could not start." };
  }
  const id = String(runId);
  let sha: string | null = null;
  let size: number | null = null;
  let counts: Record<string, number> | null = null;
  let key: string | null = null;
  try {
    const built = await buildArchive(sourceFor(admin, p.orgId), p.orgId);
    counts = built.rowCounts;
    const sealed = sealArchive(built.gz, cfg.key, p.orgId);
    sha = createHash("sha256").update(sealed).digest("hex");
    size = sealed.length;
    key = backupObjectKey(p.orgId, id);
    await cfg.target.put(key, sealed);
    // read it back from the destination, not from memory
    verifyArchive(await cfg.target.get(key), cfg.key, p.orgId, { sha256: sha, rowCounts: counts });
    await admin.rpc("backup_finish", {
      p_run: id,
      p_ok: true,
      p_size: size,
      p_sha: sha,
      p_counts: counts,
      p_key: key,
      p_dest: cfg.target.kind,
      p_verified: true,
      p_error: null,
    });
    return { ok: true, runId: id };
  } catch (e) {
    const message =
      e instanceof BackupError ? e.message : "An unexpected error stopped the backup.";
    if (!(e instanceof BackupError))
      logger.error("backup failed", { error: e instanceof Error ? e.message : "unknown" });
    await admin.rpc("backup_finish", {
      p_run: id,
      p_ok: false,
      p_size: size,
      p_sha: sha,
      p_counts: counts,
      p_key: key,
      p_dest: key ? cfg.target.kind : null,
      p_verified: false,
      p_error: message,
    });
    return { ok: false, runId: id, error: message };
  }
}

/** Re-reads a stored backup and checks it again (hash, decryption, completeness, row counts). */
export async function verifyStoredBackup(
  admin: SupabaseClient,
  cfg: { target: BackupTarget; key: Buffer },
  runId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: run } = await admin
    .from("backup_runs")
    .select("organization_id, storage_key, sha256, row_counts, status, deleted_at")
    .eq("id", runId)
    .maybeSingle();
  if (!run || run.status !== "OK" || run.deleted_at || !run.storage_key)
    return { ok: false, error: "That backup is not available." };
  try {
    verifyArchive(await cfg.target.get(run.storage_key), cfg.key, run.organization_id, {
      sha256: run.sha256,
      rowCounts: run.row_counts,
    });
    await admin.rpc("backup_record_verification", { p_run: runId, p_ok: true });
    return { ok: true };
  } catch (e) {
    await admin.rpc("backup_record_verification", { p_run: runId, p_ok: false });
    return {
      ok: false,
      error: e instanceof BackupError ? e.message : "The check could not be completed.",
    };
  }
}

/** Deletes stored copies past retention (always keeping the newest few) and marks them deleted. */
export async function pruneExpiredBackups(
  admin: SupabaseClient,
  target: BackupTarget,
): Promise<number> {
  const { data } = await admin.rpc("backup_expired");
  let n = 0;
  for (const r of (data ?? []) as {
    id: string;
    storage_key: string | null;
    destination: string;
  }[]) {
    try {
      if (r.storage_key && r.destination === target.kind) await target.delete(r.storage_key);
      await admin.rpc("backup_mark_deleted", { p_run: r.id });
      n++;
    } catch (e) {
      logger.warn("could not delete an expired backup", {
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }
  return n;
}
