import "server-only";
import { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE } from "@/lib/crm/constants";
import { sanitizeSearch } from "@/lib/crm/schemas";

export type QuotationListRow = {
  id: string;
  quotation_number: string;
  title: string;
  status: string;
  currency: string;
  valid_until: string | null;
  created_at: string;
  customers?: { name: string } | null;
  selected_total: number | null;
};

export async function listQuotations(params: { q?: string; status?: string; page?: number }) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const q = sanitizeSearch(params.q);
  let query = supabase
    .from("quotations")
    .select(
      "id, quotation_number, title, status, currency, valid_until, created_at, selected_option_id, customers ( name )",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (params.status) query = query.eq("status", params.status);
  if (q) query = query.or(`title.ilike.%${q}%,quotation_number.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw error;

  const optionIds = (data ?? [])
    .map((r) => r.selected_option_id as string | null)
    .filter((x): x is string => Boolean(x));
  const totals = new Map<string, number>();
  if (optionIds.length) {
    const { data: opts } = await supabase
      .from("quotation_options")
      .select("id, total")
      .in("id", optionIds);
    for (const o of opts ?? []) totals.set(o.id as string, Number(o.total));
  }
  const rows = (data ?? []).map((r) => ({
    ...r,
    selected_total: r.selected_option_id
      ? (totals.get(r.selected_option_id as string) ?? null)
      : null,
  }));
  return { rows: rows as unknown as QuotationListRow[], total: count ?? 0, page };
}

/** Quotation as a JSON document. Costs/profit are included only if the caller may see them (enforced in SQL). */
export async function getQuotationDocument(
  id: string,
  priv = true,
): Promise<Record<string, unknown> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quotation_document", { p_id: id, p_private: priv });
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

export type QuotationVersionRow = {
  id: string;
  version_number: number;
  label: string | null;
  created_at: string;
  created_by: string | null;
};

export async function listQuotationVersions(id: string): Promise<QuotationVersionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotation_versions")
    .select("id, version_number, label, created_at, created_by")
    .eq("quotation_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as QuotationVersionRow[];
}

export type TemplateRow = {
  id: string;
  name: string;
  intro: string | null;
  terms: string | null;
  cancellation_policy: string | null;
  payment_terms: string | null;
};

export async function listTemplates(): Promise<TemplateRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("quotation_templates").select("*").order("name").limit(200);
  return (data ?? []) as TemplateRow[];
}

export async function getTemplate(id: string): Promise<TemplateRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("quotation_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as TemplateRow | null) ?? null;
}

export type Branding = {
  logo_data: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  gst_number: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  footer_text: string | null;
};

export async function getBranding(): Promise<Branding | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("organization_branding").select("*").maybeSingle();
  return (data as Branding | null) ?? null;
}

export async function listCustomerOptionsWithId() {
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("id, name").order("name").limit(500);
  return (data ?? []).map((c) => ({ value: c.id as string, label: c.name as string }));
}
