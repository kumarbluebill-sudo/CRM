import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { getBackupConfig } from "@/lib/backup/run";
import { isRecentlyAuthenticated } from "@/lib/auth/recent";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Downloads the encrypted backup file. It is useless without the backup key, and the caller must hold backup.manage
 * in the owning agency (checked by the database), have confirmed their password recently, and every download is audited.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  const session = await getSessionContext();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!session.organization || !session.permissions.has("backup.manage"))
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  if (!(await isRecentlyAuthenticated()))
    return NextResponse.json(
      { error: "Please confirm your password again first." },
      { status: 401 },
    );
  if (!(await rateLimit(`backup-dl:${session.userId}`, 10, 60_000)).allowed)
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("backup_run_for_download", { p_id: id });
  if (error || !data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const run = data as { storageKey: string; destination: string; startedAt: string };
  const cfg = getBackupConfig();
  if ("missing" in cfg || cfg.target.kind !== run.destination)
    return NextResponse.json(
      { error: "The backup destination is not available." },
      { status: 503 },
    );
  try {
    const bytes = await cfg.target.get(run.storageKey);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="backup-${run.startedAt.slice(0, 10)}.crmbk"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "The backup could not be read." }, { status: 502 });
  }
}
