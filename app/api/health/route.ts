import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

function authorised(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * GET /api/health            public liveness check for uptime monitors: the app is up.
 * GET /api/health?deep=1     readiness (requires `Authorization: Bearer $CRON_SECRET`): the database answers and
 *                            the production configuration is complete. Reports names of problems, never values.
 */
export async function GET(req: NextRequest) {
  const version = (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7);
  if (req.nextUrl.searchParams.get("deep") !== "1") {
    return NextResponse.json({ status: "ok", version }, { headers: noStore });
  }

  const env = getServerEnv();
  if (!authorised(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
  }

  const problems: string[] = [];
  const admin = createAdminClient();
  if (!admin) problems.push("supabase_service_role");
  else {
    const started = Date.now();
    const { error } = await admin.from("plans").select("key").limit(1);
    if (error) problems.push("database");
    if (Date.now() - started > 3000) problems.push("database_slow");
  }
  if (!env.ENCRYPTION_KEY) problems.push("encryption_key");
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)
    problems.push("rate_limit_redis");
  if (!env.RAZORPAY_WEBHOOK_SECRET) problems.push("billing_webhook_secret");
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) problems.push("email");
  if (!env.SENTRY_DSN) problems.push("error_reporting");

  return NextResponse.json(
    { status: problems.length ? "degraded" : "ok", version, problems },
    { status: problems.includes("database") ? 503 : 200, headers: noStore },
  );
}
