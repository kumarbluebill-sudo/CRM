import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env.server";
import { getBackupConfig, pruneExpiredBackups, runBackup } from "@/lib/backup/run";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorised(header: string | null, secret: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Daily backup job (see vercel.json). Takes a backup for every agency that is due, then deletes copies past their
 * retention. It stops starting new backups after about 45 seconds; agencies still due are picked up on the next run.
 */
export async function GET(req: NextRequest) {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  if (!authorised(req.headers.get("authorization"), secret))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const cfg = getBackupConfig();
  if ("missing" in cfg) {
    logger.warn("scheduled backups skipped", { reason: cfg.missing });
    return NextResponse.json({ ok: true, skipped: cfg.missing });
  }
  const started = Date.now();
  const { data: due } = await admin.rpc("backup_due");
  let done = 0;
  let failed = 0;
  for (const row of (due ?? []) as { organization_id: string }[]) {
    if (Date.now() - started > 45_000) break;
    const r = await runBackup(admin, cfg, { orgId: row.organization_id, kind: "SCHEDULED" });
    if (r.ok) done++;
    else failed++;
  }
  const pruned = await pruneExpiredBackups(admin, cfg.target);
  return NextResponse.json(
    { ok: failed === 0, backedUp: done, failed, pruned },
    { status: failed ? 500 : 200 },
  );
}
