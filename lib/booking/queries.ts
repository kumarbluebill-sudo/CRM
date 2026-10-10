import "server-only";
import { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE } from "@/lib/crm/constants";
import { sanitizeSearch } from "@/lib/crm/schemas";
import { maskPassport } from "@/lib/booking/schema";

export type BookingRow = {
  id: string;
  booking_number: string;
  quotation_id: string;
  customer_id: string;
  title: string;
  destination: string | null;
  travel_start: string | null;
  travel_end: string | null;
  adults: number;
  children: number;
  status: string;
  currency: string;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  cancellation_reason: string | null;
  notes: string | null;
  created_at: string;
  customers?: { name: string } | null;
};

export async function listBookings(params: { q?: string; status?: string; page?: number }) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const q = sanitizeSearch(params.q);
  let query = supabase
    .from("bookings")
    .select("*, customers ( name )", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (params.status) query = query.eq("status", params.status);
  if (q)
    query = query.or(`title.ilike.%${q}%,booking_number.ilike.%${q}%,destination.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as BookingRow[], total: count ?? 0, page };
}

export async function getBooking(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("*, customers ( id, name, phone, email )")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as
    | (BookingRow & {
        customers: { id: string; name: string; phone: string | null; email: string | null } | null;
      })
    | null;
}

export type BookingItemRow = {
  id: string;
  position: number;
  type: string;
  description: string;
  quantity: number;
  unit_price: number | null;
  supplier_id: string | null;
  service_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  event_tz: string | null;
  dest_tz: string | null;
  confirmation_status: string;
  confirmation_reference: string | null;
  notes: string | null;
};

export async function listBookingItems(bookingId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("booking_items")
    .select("*")
    .eq("booking_id", bookingId)
    .order("position");
  if (error) throw error;
  return (data ?? []) as BookingItemRow[];
}

export type PassengerRow = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  is_lead: boolean;
  special_requirements: string | null;
};
export type PassportInfo = { masked: string; expiry: string | null; country: string | null };

export async function listPassengers(bookingId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("booking_passengers")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as PassengerRow[];
}

/** Masked passport info. RLS returns rows only for users with passengers.view_sensitive. */
export async function listPassportInfo(passengerIds: string[]): Promise<Map<string, PassportInfo>> {
  const out = new Map<string, PassportInfo>();
  if (passengerIds.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from("passenger_identity")
    .select("passenger_id, passport_number, passport_expiry, passport_country")
    .in("passenger_id", passengerIds);
  for (const r of data ?? []) {
    out.set(r.passenger_id as string, {
      masked: maskPassport(r.passport_number as string), // the full number never leaves the server here
      expiry: r.passport_expiry as string | null,
      country: r.passport_country as string | null,
    });
  }
  return out;
}

export async function listBookingHistory(bookingId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("booking_status_history")
    .select("id, from_status, to_status, reason, created_at")
    .eq("booking_id", bookingId)
    .order("created_at");
  return (data ?? []) as {
    id: string;
    from_status: string | null;
    to_status: string;
    reason: string | null;
    created_at: string;
  }[];
}

export type DocumentRow = {
  id: string;
  category: string;
  name: string;
  size_bytes: number;
  created_at: string;
  is_sensitive: boolean;
  booking_id: string | null;
  customer_id: string | null;
};

export async function listDocuments(params: {
  bookingId?: string;
  customerId?: string;
  category?: string;
  page?: number;
}) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  let query = supabase
    .from("documents")
    .select("id, category, name, size_bytes, created_at, is_sensitive, booking_id, customer_id", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (params.bookingId) query = query.eq("booking_id", params.bookingId);
  if (params.customerId) query = query.eq("customer_id", params.customerId);
  if (params.category) query = query.eq("category", params.category);
  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as DocumentRow[], total: count ?? 0, page };
}

export type SupplierRow = {
  id: string;
  type: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  destination: string | null;
  payment_terms: string | null;
  notes: string | null;
  is_active: boolean;
};

export async function listSuppliers(params: { q?: string; type?: string; page?: number }) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  const q = sanitizeSearch(params.q);
  let query = supabase
    .from("suppliers")
    .select("*", { count: "exact" })
    .order("company_name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (params.type) query = query.eq("type", params.type);
  if (q)
    query = query.or(
      `company_name.ilike.%${q}%,destination.ilike.%${q}%,contact_name.ilike.%${q}%`,
    );
  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as SupplierRow[], total: count ?? 0, page };
}

export async function getSupplier(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("suppliers").select("*").eq("id", id).maybeSingle();
  return (data as SupplierRow | null) ?? null;
}

export async function listSupplierDetail(id: string) {
  const supabase = await createClient();
  const [contacts, services] = await Promise.all([
    supabase.from("supplier_contacts").select("*").eq("supplier_id", id).order("name"),
    supabase.from("supplier_services").select("*").eq("supplier_id", id).order("name"),
  ]);
  return {
    contacts: (contacts.data ?? []) as {
      id: string;
      name: string;
      role: string | null;
      phone: string | null;
      email: string | null;
    }[],
    services: (services.data ?? []) as {
      id: string;
      name: string;
      description: string | null;
      unit_rate: number | null;
      currency: string;
      valid_from: string | null;
      valid_to: string | null;
    }[],
  };
}

export async function listSupplierOptions() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("suppliers")
    .select("id, company_name, type")
    .eq("is_active", true)
    .order("company_name")
    .limit(500);
  return (data ?? []).map((s) => ({
    value: s.id as string,
    label: `${s.company_name as string} (${(s.type as string).toLowerCase()})`,
  }));
}
