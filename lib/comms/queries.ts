import "server-only";
import { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE } from "@/lib/crm/constants";

export type CommRow = {
  id: string;
  channel: "EMAIL" | "WHATSAPP";
  template_key: string;
  customer_id: string;
  booking_id: string | null;
  to_address: string;
  status: "QUEUED" | "SENT" | "FAILED" | "CANCELLED";
  source: "MANUAL" | "AUTOMATION";
  subject: string | null;
  body: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  customers?: { name: string } | null;
  bookings?: { booking_number: string } | null;
};

export async function listCommunications(params: {
  channel?: string;
  status?: string;
  bookingId?: string;
  page?: number;
}) {
  const supabase = await createClient();
  const page = Math.max(1, params.page ?? 1);
  let q = supabase
    .from("communications")
    .select("*, customers ( name ), bookings ( booking_number )", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (params.channel) q = q.eq("channel", params.channel);
  if (params.status) q = q.eq("status", params.status);
  if (params.bookingId) q = q.eq("booking_id", params.bookingId);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as CommRow[], total: count ?? 0, page };
}

export async function listTemplates() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_templates")
    .select("template_key, channel, subject, body");
  if (error) throw error;
  return (data ?? []) as {
    template_key: string;
    channel: string;
    subject: string | null;
    body: string;
  }[];
}

export async function listRules() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_rules")
    .select("trigger, channel, template_key, days, enabled");
  if (error) throw error;
  return (data ?? []) as {
    trigger: string;
    channel: string;
    template_key: string;
    days: number;
    enabled: boolean;
  }[];
}
