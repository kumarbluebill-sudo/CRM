import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorised(header: string | null, secret: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Daily job (see vercel.json). Drafts reminder messages for each organization's enabled automation rules.
 * It never sends anything: people review and send the drafts from the outbox.
 */
export async function GET(req: NextRequest) {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  if (!authorised(req.headers.get("authorization"), secret))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const { data, error } = await admin.rpc("run_automation");
  if (error) {
    logger.error("automation run failed", { code: error.code });
    return NextResponse.json({ error: "Failed." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, drafted: data });
}
