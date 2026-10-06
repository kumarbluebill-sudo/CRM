import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ParsedItinerary } from "@/lib/import/types";

export type ImportRow = {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  status: "REVIEW" | "CONVERTED" | "DISCARDED";
  parsed: ParsedItinerary;
  source_text: string | null;
  itinerary_id: string | null;
  created_at: string;
};

export async function getImport(id: string): Promise<ImportRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("itinerary_imports")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as ImportRow | null) ?? null;
}

export async function listRecentImports() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("itinerary_imports")
    .select("id, file_name, file_type, status, created_at, itinerary_id")
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []) as Pick<
    ImportRow,
    "id" | "file_name" | "file_type" | "status" | "created_at" | "itinerary_id"
  >[];
}

/** Review state and original import (for the "items to double-check" panel on the builder page). */
export async function getReviewState(itineraryId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("itineraries")
    .select("needs_review, import_id")
    .eq("id", itineraryId)
    .maybeSingle();
  if (!data) return { needsReview: false, parsed: null as ParsedItinerary | null };
  let parsed: ParsedItinerary | null = null;
  if (data.needs_review && data.import_id) {
    const { data: imp } = await supabase
      .from("itinerary_imports")
      .select("parsed")
      .eq("id", data.import_id)
      .maybeSingle();
    parsed = (imp?.parsed as ParsedItinerary | undefined) ?? null;
  }
  return { needsReview: Boolean(data.needs_review), parsed };
}
