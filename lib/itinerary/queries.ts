import "server-only";
import { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE } from "@/lib/crm/constants";
import { sanitizeSearch } from "@/lib/crm/schemas";

export type ItineraryListRow = {
  id: string;
  title: string;
  destination: string | null;
  status: string;
  is_template: boolean;
  start_date: string | null;
  updated_at: string;
  customers?: { name: string } | null;
};

export async function listItineraries(params: { templates: boolean; q?: string; page?: number }) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const q = sanitizeSearch(params.q);
  let query = supabase
    .from("itineraries")
    .select(
      "id, title, destination, status, is_template, start_date, updated_at, customers ( name )",
      {
        count: "exact",
      },
    )
    .eq("is_template", params.templates)
    .order("updated_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) query = query.or(`title.ilike.%${q}%,destination.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as ItineraryListRow[], total: count ?? 0, page };
}

/** Full itinerary document, or null if it doesn't exist or belongs to another organization (RLS). */
export async function getItineraryDocument(id: string): Promise<Record<string, unknown> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("itinerary_document", { p_id: id });
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

export type VersionRow = {
  id: string;
  version_number: number;
  label: string | null;
  created_at: string;
  snapshot: Record<string, unknown>;
};

export async function listItineraryVersions(id: string): Promise<VersionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("itinerary_versions")
    .select("id, version_number, label, created_at, snapshot")
    .eq("itinerary_id", id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as VersionRow[];
}

export async function listTemplateOptions() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("itineraries")
    .select("id, title")
    .eq("is_template", true)
    .order("title")
    .limit(200);
  return (data ?? []).map((t) => ({ value: t.id as string, label: t.title as string }));
}
