import "server-only";
import { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE } from "@/lib/crm/constants";
import { sanitizeSearch } from "@/lib/crm/schemas";

/** Everything here reads through the caller's own session, so RLS decides what comes back. */

export type EnquiryRow = {
  id: string;
  enquiry_number: string;
  customer_id: string;
  country_id: string | null;
  product_id: string | null;
  nationality: string | null;
  travel_date: string | null;
  travellers: number;
  source: string | null;
  assigned_to: string | null;
  priority: string;
  follow_up_date: string | null;
  notes: string | null;
  status: string;
  converted_application_id: string | null;
  created_at: string;
  customers?: { name: string; phone: string | null; email: string | null } | null;
  visa_countries?: { name: string } | null;
};

export type ApplicationRow = {
  id: string;
  application_number: string;
  customer_id: string;
  enquiry_id: string | null;
  product_id: string;
  country_id: string;
  visa_type: string;
  nationality: string;
  travel_date: string | null;
  travellers_planned: number;
  status: string;
  priority: string;
  sales_user_id: string | null;
  processor_user_id: string | null;
  manager_user_id: string | null;
  supplier_id: string | null;
  booking_id: string | null;
  internal_notes: string | null;
  customer_notes: string | null;
  status_reason: string | null;
  submitted_at: string | null;
  express: boolean;
  unit_price: number | null;
  discount_amount: number;
  discount_reason: string | null;
  total_price: number | null;
  price_currency: string | null;
  priced_at: string | null;
  expected_completion: string | null;
  quotation_id: string | null;
  created_at: string;
  customers?: { id?: string; name: string; phone?: string | null; email?: string | null } | null;
  visa_countries?: { name: string; iso_code?: string } | null;
  visa_products?: {
    visa_type: string;
    entry_type: string;
    passport_validity_months: number;
    processing_days_normal: number | null;
    stay_days: number | null;
  } | null;
};

export type TravellerRow = {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  applicant_type: string;
  email: string | null;
  mobile: string | null;
  address: string | null;
  occupation: string | null;
  previous_visa: string | null;
  previous_travel: string | null;
  is_lead: boolean;
};
export type IdentityRow = {
  traveller_id: string;
  passport_number: string;
  issue_date: string | null;
  expiry_date: string | null;
  issuing_country: string | null;
};

export type ChecklistRow = {
  id: string;
  traveller_id: string | null;
  document_type_id: string | null;
  name: string;
  required: boolean;
  status: string;
  document_id: string | null;
  review_note: string | null;
  requested_at: string | null;
  received_at: string | null;
  reviewed_at: string | null;
  sort: number;
  visa_travellers?: { first_name: string; last_name: string | null } | null;
  documents?: { name: string; mime_type: string; size_bytes: number } | null;
};

const personName = (t?: { first_name: string; last_name: string | null } | null) =>
  t ? `${t.first_name}${t.last_name ? ` ${t.last_name}` : ""}` : "Application";
export { personName };

/** Customer ids whose name matches (used to search applications and enquiries by customer name). */
async function customerIdsLike(q: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("id").ilike("name", `%${q}%`).limit(50);
  return (data ?? []).map((c) => c.id as string);
}

export async function listEnquiries(params: {
  q?: string;
  status?: string;
  assigned?: string;
  page?: number;
}) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const q = sanitizeSearch(params.q);
  let query = supabase
    .from("visa_enquiries")
    .select("*, customers ( name, phone, email ), visa_countries ( name )", { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (params.status) query = query.eq("status", params.status);
  if (params.assigned) query = query.eq("assigned_to", params.assigned);
  if (q) {
    const ids = await customerIdsLike(q);
    query = query.or(
      [`enquiry_number.ilike.%${q}%`, ids.length ? `customer_id.in.(${ids.join(",")})` : null]
        .filter(Boolean)
        .join(","),
    );
  }
  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as EnquiryRow[], total: count ?? 0, page };
}

export async function getEnquiry(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visa_enquiries")
    .select("*, customers ( name, phone, email ), visa_countries ( name )")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as EnquiryRow | null;
}

export async function listApplications(params: {
  q?: string;
  status?: string;
  priority?: string;
  countryId?: string;
  staff?: string;
  page?: number;
  canSeePassports: boolean;
}) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const q = sanitizeSearch(params.q);
  let query = supabase
    .from("visa_applications")
    .select("*, customers ( name, phone ), visa_countries ( name, iso_code )", { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (params.status) query = query.eq("status", params.status);
  if (params.priority) query = query.eq("priority", params.priority);
  if (params.countryId) query = query.eq("country_id", params.countryId);
  if (params.staff)
    query = query.or(`sales_user_id.eq.${params.staff},processor_user_id.eq.${params.staff}`);
  if (q) {
    const clauses = [`application_number.ilike.%${q}%`];
    const ids = await customerIdsLike(q);
    if (ids.length) clauses.push(`customer_id.in.(${ids.join(",")})`);
    // A passport number search needs the identity table, which only permitted staff can read.
    if (params.canSeePassports && /^[A-Za-z0-9]{6,12}$/.test(q)) {
      const { data: hit } = await supabase
        .from("visa_traveller_identity")
        .select("traveller_id")
        .eq("passport_number", q.toUpperCase())
        .limit(20);
      const tids = (hit ?? []).map((h) => h.traveller_id as string);
      if (tids.length) {
        const { data: apps } = await supabase
          .from("visa_travellers")
          .select("application_id")
          .in("id", tids);
        const aids = [...new Set((apps ?? []).map((a) => a.application_id as string))];
        if (aids.length) clauses.push(`id.in.(${aids.join(",")})`);
      }
    }
    query = query.or(clauses.join(","));
  }
  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as ApplicationRow[], total: count ?? 0, page };
}

export async function getApplication(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visa_applications")
    .select(
      "*, customers ( id, name, phone, email ), visa_countries ( name, iso_code ), visa_products ( visa_type, entry_type, passport_validity_months, processing_days_normal, stay_days )",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as ApplicationRow | null;
}

export async function listTravellers(applicationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visa_travellers")
    .select("*")
    .eq("application_id", applicationId)
    .is("deleted_at", null)
    .order("is_lead", { ascending: false })
    .order("created_at");
  if (error) throw error;
  const travellers = (data ?? []) as unknown as TravellerRow[];
  // Empty for anyone without visa.document.view: RLS, not application code, is what withholds it.
  const { data: ids } = travellers.length
    ? await supabase
        .from("visa_traveller_identity")
        .select("traveller_id, passport_number, issue_date, expiry_date, issuing_country")
        .in(
          "traveller_id",
          travellers.map((t) => t.id),
        )
    : { data: [] };
  const identity = new Map(((ids ?? []) as IdentityRow[]).map((i) => [i.traveller_id, i]));
  return { travellers, identity };
}

export async function listChecklist(applicationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visa_application_documents")
    .select(
      "*, visa_travellers ( first_name, last_name, deleted_at ), documents ( name, mime_type, size_bytes )",
    )
    .eq("application_id", applicationId)
    .neq("status", "NOT_REQUIRED")
    .order("sort")
    .order("created_at");
  if (error) throw error;
  return (
    (data ?? []) as unknown as (ChecklistRow & {
      visa_travellers?: { deleted_at: string | null } | null;
    })[]
  ).filter((r) => !r.visa_travellers?.deleted_at) as ChecklistRow[];
}

export async function listEvents(applicationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visa_events")
    .select("id, event_type, summary, actor_id, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    event_type: string;
    summary: string;
    actor_id: string | null;
    created_at: string;
  }[];
}

export async function listApplicationTasks(applicationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, due_date, status, priority, assigned_to, kind")
    .eq("related_type", "VISA_APPLICATION")
    .eq("related_id", applicationId)
    .order("due_date", { nullsFirst: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    title: string;
    due_date: string | null;
    status: string;
    priority: string;
    assigned_to: string | null;
    kind: string;
  }[];
}

export async function getVisaDashboard() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("visa_dashboard");
  if (error) throw error;
  return data as {
    byStatus: Record<string, number>;
    enquiriesOpen: number;
    followUpsDue: number;
    documentsToReview: number;
    documentsPending: number;
    corrections: number;
    urgent: number;
    mine: number;
  };
}

// ---- master data ----
export async function listCountries(activeOnly = false) {
  const supabase = await createClient();
  let q = supabase
    .from("visa_countries")
    .select("id, name, iso_code, region, active")
    .order("name");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    name: string;
    iso_code: string;
    region: string | null;
    active: boolean;
  }[];
}

export async function listDocumentTypes() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visa_document_types")
    .select("id, code, name, storage_category, active")
    .order("name");
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    code: string;
    name: string;
    storage_category: string;
    active: boolean;
  }[];
}

export type ProductRow = {
  id: string;
  country_id: string;
  visa_type: string;
  entry_type: string;
  nationality: string | null;
  stay_days: number | null;
  validity_days: number | null;
  passport_validity_months: number;
  processing_days_normal: number | null;
  processing_days_express: number | null;
  service_fee: number;
  express_fee: number;
  markup_percent: number;
  gst_percent: number;
  currency: string;
  supplier_id: string | null;
  source: string | null;
  active: boolean;
  updated_at: string;
  visa_countries?: { name: string } | null;
};

export async function listProducts(params: { activeOnly?: boolean; countryId?: string } = {}) {
  const supabase = await createClient();
  let q = supabase
    .from("visa_products")
    .select("*, visa_countries ( name )")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (params.activeOnly) q = q.eq("active", true);
  if (params.countryId) q = q.eq("country_id", params.countryId);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as unknown as ProductRow[];
  // Selling price comes from a function that never reveals cost.
  const prices = await Promise.all(
    rows.map(async (r) => {
      const { data: p } = await supabase.rpc("visa_unit_price", {
        p_product: r.id,
        p_express: false,
      });
      return [r.id, p === null || p === undefined ? null : Number(p)] as const;
    }),
  );
  const price = new Map(prices);
  return rows.map((r) => ({ ...r, unit_price: price.get(r.id) ?? null }));
}

export async function getProduct(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visa_products")
    .select("*, visa_countries ( name )")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: price } = await supabase.rpc("visa_unit_price", {
    p_product: id,
    p_express: false,
  });
  const { data: express } = await supabase.rpc("visa_unit_price", {
    p_product: id,
    p_express: true,
  });
  return {
    product: data as unknown as ProductRow,
    unitPrice: price == null ? null : Number(price),
    expressPrice: express == null ? null : Number(express),
  };
}

/** Empty for anyone without visa.supplier.view (RLS). */
export async function getProductCost(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("visa_product_costs")
    .select("government_fee, supplier_fee")
    .eq("product_id", id)
    .maybeSingle();
  return data as { government_fee: number; supplier_fee: number } | null;
}

export async function listRequirements(productId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visa_requirements")
    .select("id, nationality, applicant_type, required, sort, visa_document_types ( name, code )")
    .eq("product_id", productId)
    .order("sort");
  if (error) throw error;
  return (data ?? []) as unknown as {
    id: string;
    nationality: string | null;
    applicant_type: string;
    required: boolean;
    sort: number;
    visa_document_types: { name: string; code: string } | null;
  }[];
}

export async function listPriceHistory(productId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("visa_price_history")
    .select("id, old_price, new_price, cost_changed, reason, changed_by, created_at")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as {
    id: string;
    old_price: number | null;
    new_price: number;
    cost_changed: boolean;
    reason: string;
    changed_by: string | null;
    created_at: string;
  }[];
}

export async function listVisaSuppliers() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("suppliers")
    .select("id, company_name")
    .eq("type", "VISA")
    .eq("is_active", true)
    .order("company_name")
    .limit(200);
  return (data ?? []).map((s) => ({ value: s.id as string, label: s.company_name as string }));
}

/** Customer search for the "find an existing customer first" step. */
export async function findCustomerDuplicates(input: {
  mobile?: string;
  email?: string;
  passport?: string;
  name?: string;
  dob?: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("find_visa_customer_duplicates", {
    p_mobile: input.mobile ?? null,
    p_email: input.email ?? null,
    p_passport: input.passport ?? null,
    p_name: input.name ?? null,
    p_dob: input.dob ?? null,
  });
  if (error) return [];
  return (data ?? []) as { customer_id: string; customer_name: string; matched_on: string }[];
}

// ---- commerce: pricing, quotation/booking, supplier, results, delivery, messages, work queue ----
export async function getLinkedQuotation(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("quotations")
    .select("id, quotation_number, status")
    .eq("id", id)
    .maybeSingle();
  return data as { id: string; quotation_number: string; status: string } | null;
}

export async function getLinkedBooking(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("id, booking_number, status, currency, total_amount, paid_amount, balance_amount")
    .eq("id", id)
    .maybeSingle();
  return data as {
    id: string;
    booking_number: string;
    status: string;
    currency: string;
    total_amount: number;
    paid_amount: number;
    balance_amount: number;
  } | null;
}

export type SubmissionRow = {
  id: string;
  supplier_id: string | null;
  reference: string | null;
  submitted_on: string;
  expected_completion: string | null;
  actual_completion: string | null;
  cost: number | null;
  notes: string | null;
  suppliers?: { company_name: string } | null;
};

/** Empty for anyone without visa.supplier.view (row security hides the table). */
export async function listSubmissions(applicationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visa_supplier_submissions")
    .select("*, suppliers ( company_name )")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as SubmissionRow[];
}

export type ResultRow = {
  id: string;
  traveller_id: string;
  document_id: string | null;
  visa_number: string | null;
  valid_from: string | null;
  valid_until: string | null;
  notes: string | null;
};

export async function listResults(applicationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visa_results")
    .select("*")
    .eq("application_id", applicationId);
  if (error) throw error;
  return (data ?? []) as ResultRow[];
}

export async function listDeliveries(applicationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visa_deliveries")
    .select("id, method, delivered_on, confirmation, notes, delivered_by")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    method: string;
    delivered_on: string;
    confirmation: string | null;
    notes: string | null;
    delivered_by: string | null;
  }[];
}

export async function listVisaMessages(applicationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communications")
    .select("id, channel, template_key, status, created_at, sent_at")
    .eq("visa_application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    channel: string;
    template_key: string;
    status: string;
    created_at: string;
    sent_at: string | null;
  }[];
}

export type WorkQueue = {
  review: { id: string; applicationId: string; number: string; name: string }[];
  corrections: { applicationId: string; number: string; note: string | null }[];
  toSubmit: { applicationId: string; number: string; travelDate: string | null }[];
  overdue: { applicationId: string; number: string; expected: string }[];
  toRecord: { applicationId: string; number: string }[];
  toDeliver: { applicationId: string; number: string; travelDate: string | null }[];
  followUps: { id: string; title: string; due: string; applicationId: string }[];
  counts: Record<
    | "review"
    | "corrections"
    | "toSubmit"
    | "overdue"
    | "toRecord"
    | "toDeliver"
    | "followUps"
    | "unpriced",
    number
  >;
};

export async function getWorkQueue(mine = true) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("visa_work_queue", { p_mine: mine });
  if (error) throw error;
  return data as WorkQueue;
}
