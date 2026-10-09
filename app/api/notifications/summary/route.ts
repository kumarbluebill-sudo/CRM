import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { latestNotifications, unreadCount } from "@/lib/notifications/queries";

export const runtime = "nodejs";

/** Polled by the bell. Returns only the signed-in user's own notifications (row security), never cached. */
export async function GET() {
  const session = await getSessionContext();
  if (!session?.organization)
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!(await rateLimit(`notif-poll:${session.userId}`, 120, 60_000)).allowed)
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  try {
    const [unread, items] = await Promise.all([unreadCount(), latestNotifications(8)]);
    return NextResponse.json(
      { unread, items },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Could not load notifications." }, { status: 500 });
  }
}
