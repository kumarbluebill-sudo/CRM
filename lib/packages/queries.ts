import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getItineraryDocument } from "@/lib/itinerary/queries";
import { toEditorDoc, type EditorDoc } from "@/lib/itinerary/schema";
import { getBranding, type Branding } from "@/lib/quotation/queries";
import { resolveTheme, templateByKey, type Theme } from "@/lib/packages/templates";

export type PackageDetails = {
  template_key: string;
  theme: Record<string, unknown>;
  return_date: string | null;
  hotel_category: string | null;
  accommodation: string | null;
  transport: string | null;
  flights: string | null;
  meals: string | null;
  activities: string | null;
  price: number | null;
  currency: string;
  price_note: string | null;
  child_price: number | null;
  extra_person_price: number | null;
  cancellation_policy: string | null;
  terms: string | null;
  travel_notes: string | null;
  cta_text: string | null;
};

export type PackageImage = {
  id: string;
  name: string;
  alt: string | null;
  width: number;
  height: number;
  storage_path?: string;
  created_at: string;
};

export type ImageLink = {
  id: string;
  role: "COVER" | "GALLERY" | "HOTEL" | "DAY";
  day_number: number | null;
  position: number;
  caption: string | null;
  image_id: string;
  package_images: PackageImage | null;
};

export type PackageBundle = {
  id: string;
  doc: EditorDoc;
  status: string;
  details: PackageDetails | null;
  links: ImageLink[];
  theme: Theme;
  templateKey: string;
  branding: Branding | null;
  nights: number;
};

export async function getPackageBundle(id: string): Promise<PackageBundle | null> {
  const raw = await getItineraryDocument(id);
  if (!raw) return null;
  const supabase = await createClient();
  const [{ data: details }, { data: links }, branding] = await Promise.all([
    supabase.from("package_details").select("*").eq("itinerary_id", id).maybeSingle(),
    supabase
      .from("package_image_links")
      .select(
        "id, role, day_number, position, caption, image_id, package_images ( id, name, alt, width, height, created_at )",
      )
      .eq("itinerary_id", id)
      .order("position"),
    getBranding(),
  ]);
  const d = (details as PackageDetails | null) ?? null;
  const doc = toEditorDoc(raw);
  const days = doc.days.length;
  return {
    id,
    doc,
    status: String(raw.status ?? "DRAFT"),
    details: d,
    links: (links ?? []) as unknown as ImageLink[],
    templateKey: templateByKey(d?.template_key).key,
    theme: resolveTheme(d?.template_key, d?.theme),
    branding,
    nights: Math.max(0, days - 1),
  };
}

/** The agency's whole image library, newest first. */
export async function listPackageImages(limit = 60) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("package_images")
    .select("id, name, alt, width, height, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PackageImage[];
}
