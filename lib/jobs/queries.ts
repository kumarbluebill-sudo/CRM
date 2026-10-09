import { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE } from "@/lib/crm/constants";

export type StaffRow = {
  user_id: string;
  name: string;
  role: string;
  employee_code: string | null;
  designation: string | null;
  department: string | null;
  reporting_manager_id: string | null;
  active: boolean;
  open_jobs: number | null;
  overdue_jobs: number | null;
  completed_jobs: number | null;
};

export async function getStaffDirectory() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_directory");
  if (error) throw error;
  return (data ?? []) as StaffRow[];
}

export type JobRow = {
  id: string;
  job_number: string;
  title: string;
  instructions: string | null;
  customer_id: string | null;
  related_type: string | null;
  related_id: string | null;
  assigned_to: string | null;
  assigned_team: string | null;
  assigning_manager_id: string | null;
  priority: string;
  status: string;
  start_date: string | null;
  deadline: string | null;
  completion_notes: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  is_overdue: boolean;
};

export async function listJobs(params: {
  status?: string;
  priority?: string;
  assignee?: string;
  assigneeIds?: string[];
  mine?: string;
  overdue?: boolean;
  q?: string;
  page?: number;
}) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  let q = supabase
    .from("job_orders_v")
    .select("*", { count: "exact" })
    .order("is_overdue", { ascending: false })
    .order("deadline", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (params.status === "OPEN") q = q.not("status", "in", "(COMPLETED,CANCELLED)");
  else if (params.status) q = q.eq("status", params.status);
  if (params.priority) q = q.eq("priority", params.priority);
  if (params.assignee) q = q.eq("assigned_to", params.assignee);
  if (params.assigneeIds)
    q = params.assigneeIds.length
      ? q.in("assigned_to", params.assigneeIds)
      : q.eq("assigned_to", "00000000-0000-0000-0000-000000000000");
  if (params.mine) q = q.eq("assigned_to", params.mine);
  if (params.overdue) q = q.eq("is_overdue", true);
  if (params.q)
    q = q.or(
      `title.ilike.%${params.q.replace(/[%,()]/g, " ")}%,job_number.ilike.%${params.q.replace(/[%,()]/g, " ")}%`,
    );
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as JobRow[], total: count ?? 0, page };
}

export async function getJob(id: string) {
  const supabase = await createClient();
  const { data: job } = await supabase.from("job_orders_v").select("*").eq("id", id).maybeSingle();
  if (!job) return null;
  const { data: events } = await supabase
    .from("job_order_events")
    .select("id, kind, actor_id, from_status, to_status, note, meta, created_at")
    .eq("job_order_id", id)
    .order("created_at", { ascending: true });
  return {
    job: job as JobRow,
    events: (events ?? []) as {
      id: string;
      kind: string;
      actor_id: string | null;
      from_status: string | null;
      to_status: string | null;
      note: string | null;
      meta: Record<string, unknown>;
      created_at: string;
    }[],
  };
}

export async function getJobsDashboard() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("jobs_dashboard");
  if (error) throw error;
  return data as {
    pending: number;
    active: number;
    completed: number;
    overdue: number;
    overdueList: {
      id: string;
      number: string;
      title: string;
      deadline: string;
      priority: string;
    }[];
  };
}

/** Which record a job points at, for display and linking. */
export function relatedHref(type: string | null, id: string | null) {
  if (!type || !id) return null;
  const map: Record<string, string> = {
    BOOKING: `/bookings/${id}`,
    LEAD: `/leads/${id}`,
    ITINERARY: `/itineraries/${id}`,
    VISA_APPLICATION: `/visa/applications/${id}`,
    INVOICE: `/payments/invoices/${id}`,
    QUOTATION: `/quotations/${id}`,
  };
  return map[type] ?? null;
}
