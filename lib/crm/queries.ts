import "server-only";
import { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE, type LeadStatus } from "@/lib/crm/constants";
import { sanitizeSearch } from "@/lib/crm/schemas";
import type { CustomerRow, LeadRow, Option, TaskRow, TeamMember } from "@/lib/crm/types";

/**
 * All reads go through the user's Supabase session, so Postgres RLS scopes every
 * query to the caller's organization and permissions. No organization_id is passed.
 */

const LEAD_COLUMNS = "*, customers ( id, name, phone )";

export async function listLeads(params: { q?: string; status?: string; page?: number }) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const q = sanitizeSearch(params.q);
  let query = supabase
    .from("leads")
    .select(LEAD_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (params.status) query = query.eq("status", params.status);
  if (q) query = query.or(`title.ilike.%${q}%,destination.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as LeadRow[], total: count ?? 0, page };
}

/** Pipeline board: capped, most recent first. */
export async function listBoardLeads(q?: string) {
  const supabase = await createClient();
  const search = sanitizeSearch(q);
  let query = supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(300);
  if (search) query = query.or(`title.ilike.%${search}%,destination.ilike.%${search}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as LeadRow[];
}

export async function getLead(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as LeadRow | null;
}

export async function listLeadTimeline(leadId: string) {
  const supabase = await createClient();
  const [activities, notes] = await Promise.all([
    supabase
      .from("lead_activities")
      .select("id, type, summary, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("lead_notes")
      .select("id, body, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (activities.error) throw activities.error;
  if (notes.error) throw notes.error;
  return {
    activities: (activities.data ?? []) as {
      id: string;
      type: string;
      summary: string;
      created_at: string;
    }[],
    notes: (notes.data ?? []) as { id: string; body: string; created_at: string }[],
  };
}

export async function listCustomers(params: { q?: string; page?: number }) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const q = sanitizeSearch(params.q);
  let query = supabase
    .from("customers")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as CustomerRow[], total: count ?? 0, page };
}

export async function getCustomer(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as CustomerRow | null;
}

export async function listCustomerLeads(customerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("id, title, destination, status, departure_date")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as Pick<
    LeadRow,
    "id" | "title" | "destination" | "status" | "departure_date"
  >[];
}

/** Customer picker options. Capped; becomes a searchable combobox when lists grow. */
export async function listCustomerOptions(): Promise<Option[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("id, name").order("name").limit(500);
  return (data ?? []).map((c) => ({ value: c.id as string, label: c.name as string }));
}

export async function listLeadSourceOptions(): Promise<Option[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("lead_sources").select("id, name").order("name");
  return (data ?? []).map((s) => ({ value: s.id as string, label: s.name as string }));
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data: members } = await supabase.from("organization_members").select("user_id");
  const ids = (members ?? []).map((m) => m.user_id as string);
  if (ids.length === 0) return [];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);
  return (profiles ?? []).map((p) => ({
    userId: p.id as string,
    name: (p.full_name as string) || (p.email as string),
  }));
}

export async function listTasks(params: {
  scope: "open" | "done";
  page?: number;
  relatedId?: string;
}) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  let query = supabase
    .from("tasks")
    .select("*", { count: "exact" })
    .in("status", params.scope === "open" ? ["TODO", "IN_PROGRESS"] : ["COMPLETED", "CANCELLED"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (params.relatedId) query = query.eq("related_id", params.relatedId);
  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as TaskRow[], total: count ?? 0, page };
}

export async function getDashboardStats() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const count = async (build: (q: ReturnType<typeof base>) => unknown) => {
    const { count: n } = (await build(base())) as { count: number | null };
    return n ?? 0;
  };
  const base = () => supabase.from("leads").select("id", { count: "exact", head: true });
  const [newLeads, hotLeads, followups] = await Promise.all([
    count((q) => q.eq("status", "NEW")),
    count((q) => q.in("priority", ["HIGH", "URGENT"]).not("status", "in", "(CONFIRMED,LOST)")),
    supabase
      .from("tasks")
      .select("id, title, due_date, related_type, related_id", { count: "exact" })
      .eq("kind", "FOLLOWUP")
      .in("status", ["TODO", "IN_PROGRESS"])
      .lte("due_date", today)
      .order("due_date")
      .limit(5),
  ]);
  const recent = await supabase
    .from("leads")
    .select("id, title, destination, status")
    .order("created_at", { ascending: false })
    .limit(5);
  return {
    newLeads,
    hotLeads,
    followups: (followups.data ?? []) as { id: string; title: string; due_date: string | null }[],
    recentLeads: (recent.data ?? []) as Pick<LeadRow, "id" | "title" | "destination" | "status">[],
  };
}

export type { LeadStatus };
