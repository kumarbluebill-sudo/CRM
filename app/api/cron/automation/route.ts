import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env.server";
import { getPublicEnv } from "@/lib/env";
import { logger } from "@/lib/utils/logger";
import { sendEmail, EmailNotConfiguredError } from "@/lib/comms/email";
import { notificationHref } from "@/lib/notifications/links";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorised(header: string | null, secret: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Daily job (see vercel.json).
 *  1. Drafts reminder messages for each organization's enabled automation rules (never sends them).
 *  2. Creates due notifications: departures, overdue payments, job deadlines, missing visa documents.
 *  3. Emails the notifications people opted into by email: headline and a link only, no customer or passport details.
 * Each step is independent: one failing does not stop the others.
 */
export async function GET(req: NextRequest) {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  if (!authorised(req.headers.get("authorization"), secret))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const result: Record<string, unknown> = { ok: true };

  const automation = await admin.rpc("run_automation");
  if (automation.error) {
    logger.error("automation run failed", { code: automation.error.code });
    result.ok = false;
  } else result.drafted = automation.data;

  const sweeps = await admin.rpc("run_notification_sweeps");
  if (sweeps.error) {
    logger.error("notification sweep failed", { code: sweeps.error.code });
    result.ok = false;
  } else result.notified = sweeps.data;

  const pruned = await admin.rpc("prune_security_events");
  if (pruned.error) logger.error("security event prune failed", { code: pruned.error.code });

  try {
    const { data: pending } = await admin.rpc("pending_notification_emails", { p_limit: 100 });
    const base = getPublicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
    let sent = 0;
    for (const n of (pending ?? []) as {
      id: string;
      user_id: string;
      title: string;
      body: string | null;
      entity_type: string | null;
      entity_id: string | null;
    }[]) {
      try {
        const { data: user } = await admin.auth.admin.getUserById(n.user_id);
        const to = user?.user?.email;
        if (!to) throw new Error("no email address");
        await sendEmail({
          to,
          subject: n.title.slice(0, 150),
          text: `${n.title}\n${n.body ? `\n${n.body}\n` : ""}\nOpen it: ${base}${notificationHref(n.entity_type, n.entity_id)}\n\nYou can change which emails you get under Notifications > Preferences.`,
          fromName: "Smart Travel CRM",
        });
        await admin.rpc("record_notification_email", { p_id: n.id, p_ok: true });
        sent++;
      } catch (e) {
        await admin.rpc("record_notification_email", {
          p_id: n.id,
          p_ok: false,
          p_error:
            e instanceof EmailNotConfiguredError
              ? "Email is not configured"
              : e instanceof Error
                ? e.message
                : "unknown",
        });
      }
    }
    result.emailed = sent;
  } catch (e) {
    logger.error("notification email step failed", {
      error: e instanceof Error ? e.message : "unknown",
    });
    result.ok = false;
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
