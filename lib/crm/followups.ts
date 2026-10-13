import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayInZone } from "@/lib/crm/followup-date";
import { getDisplayPrefs } from "@/lib/datetime/prefs";

/**
 * Follow-ups come from two places: scheduled follow-up tasks, and the "next follow-up date" set on a lead.
 * Both are read under the user's session, so RLS limits them to their agency and permissions.
 */

export type FollowupTask = {
  id: string;
  title: string;
  due_date: string | null;
  priority: string;
  status: string;
  assigned_to: string | null;
  related_type: string | null;
  related_id: string | null;
};

export type FollowupLead = {
  id: string;
  reference_number: string;
  title: string;
  contact_name: string | null;
  contact_phone: string | null;
  next_follow_up_date: string;
  assigned_user_id: string | null;
  status: string;
};

const CLOSED_LEAD = "(CONFIRMED,LOST)";

/** Number of follow-ups due today or overdue, for the sidebar badge. */
export async function followupBadgeCount(opts: {
  tasks: boolean;
  leads: boolean;
}): Promise<number> {
  const supabase = await createClient();
  const today = todayInZone(new Date(), (await getDisplayPrefs()).timeZone);
  const [t, l] = await Promise.all([
    opts.tasks
      ? supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("kind", "FOLLOWUP")
          .in("status", ["TODO", "IN_PROGRESS"])
          .lte("due_date", today)
      : null,
    opts.leads
      ? supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .not("status", "in", CLOSED_LEAD)
          .lte("next_follow_up_date", today)
      : null,
  ]);
  return (t?.count ?? 0) + (l?.count ?? 0);
}

export async function listFollowups(opts: { done: boolean; tasks: boolean; leads: boolean }) {
  const supabase = await createClient();
  const [tasks, leads] = await Promise.all([
    opts.tasks
      ? supabase
          .from("tasks")
          .select("id, title, due_date, priority, status, assigned_to, related_type, related_id")
          .eq("kind", "FOLLOWUP")
          .in("status", opts.done ? ["COMPLETED", "CANCELLED"] : ["TODO", "IN_PROGRESS"])
          .order("due_date", { ascending: !opts.done, nullsFirst: false })
          .limit(200)
      : null,
    opts.leads && !opts.done
      ? supabase
          .from("leads")
          .select(
            "id, reference_number, title, contact_name, contact_phone, next_follow_up_date, assigned_user_id, status",
          )
          .not("next_follow_up_date", "is", null)
          .not("status", "in", CLOSED_LEAD)
          .order("next_follow_up_date", { ascending: true })
          .limit(200)
      : null,
  ]);
  if (tasks?.error) throw tasks.error;
  if (leads?.error) throw leads.error;
  return {
    tasks: (tasks?.data ?? []) as FollowupTask[],
    leads: (leads?.data ?? []) as FollowupLead[],
  };
}
