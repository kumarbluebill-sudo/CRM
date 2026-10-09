import { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE } from "@/lib/crm/constants";
import { notificationHref } from "@/lib/notifications/links";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string;
  read: boolean;
  createdAt: string;
};

type Row = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

const COLUMNS = "id, type, title, body, entity_type, entity_id, read_at, created_at";
const toItem = (r: Row): NotificationItem => ({
  id: r.id,
  type: r.type,
  title: r.title,
  body: r.body,
  href: notificationHref(r.entity_type, r.entity_id),
  read: r.read_at !== null,
  createdAt: r.created_at,
});

export async function unreadCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  return count ?? 0;
}

export async function latestNotifications(limit = 8) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Row[]).map(toItem);
}

export async function listNotifications(params: { page?: number; unreadOnly?: boolean }) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  let q = supabase
    .from("notifications")
    .select(COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (params.unreadOnly) q = q.is("read_at", null);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: ((data ?? []) as Row[]).map(toItem), total: count ?? 0, page };
}

export async function getPreferences() {
  const supabase = await createClient();
  const { data } = await supabase.from("notification_preferences").select("type, in_app, email");
  return new Map(
    ((data ?? []) as { type: string; in_app: boolean; email: boolean }[]).map((p) => [p.type, p]),
  );
}
