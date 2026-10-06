import type { LeadStatus } from "@/lib/crm/constants";

export type LeadRow = {
  id: string;
  customer_id: string | null;
  title: string;
  destination: string | null;
  departure_date: string | null;
  return_date: string | null;
  adults: number;
  children: number;
  infants: number;
  budget: number | null;
  currency: string;
  trip_type: string;
  hotel_category: string | null;
  transport_required: boolean;
  visa_required: boolean;
  insurance_required: boolean;
  lead_source_id: string | null;
  assigned_user_id: string | null;
  priority: string;
  status: LeadStatus;
  notes: string | null;
  created_at: string;
  customers?: { id: string; name: string; phone: string | null } | null;
};

export type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  date_of_birth: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  nationality: string | null;
  notes: string | null;
  created_at: string;
};

export type TaskRow = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  assigned_to: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  related_type: string | null;
  related_id: string | null;
  created_at: string;
};

export type TeamMember = { userId: string; name: string };
export type Option = { value: string; label: string };
