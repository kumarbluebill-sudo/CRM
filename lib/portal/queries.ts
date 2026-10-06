import "server-only";
import { clientIp } from "@/lib/utils/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { hashPortalToken, isPortalToken } from "@/lib/portal/token";

export type PortalView = {
  org: {
    name: string;
    logo: string | null;
    primary: string | null;
    phone: string | null;
    email: string | null;
  };
  customer: { name: string };
  booking: {
    number: string;
    title: string;
    destination: string | null;
    travelStart: string | null;
    travelEnd: string | null;
    adults: number;
    children: number;
    status: string;
    currency: string;
    total: number;
    paid: number;
    balance: number;
  };
  passengers: string[];
  services: { type: string; description: string; date: string | null; confirmed: boolean }[];
  itinerary: { day: number; title: string | null; description: string | null }[];
  schedule: { label: string; dueDate: string; amount: number; covered: number; status: string }[];
  payments: { amount: number; method: string; paidAt: string; receipt: string }[];
  invoices: { number: string; issued: string; due: string | null; total: number }[];
  documents: { id: string; name: string; category: string }[];
};

export { clientIp };

/**
 * Looks up a portal link. The token is checked for shape first, the lookup is rate limited per IP, and the database
 * returns a fixed projection (see 019_portal.sql). Returns null for anything wrong, expired or revoked, with no hint
 * as to which.
 */
export async function getPortalView(token: string): Promise<PortalView | null> {
  if (!isPortalToken(token)) return null;
  const admin = createAdminClient();
  if (!admin) return null;
  const ip = await clientIp();
  if (!(await rateLimit(`portal-view:${ip}`, 60, 60_000)).allowed) return null;
  const { data, error } = await admin.rpc("portal_view", { p_hash: hashPortalToken(token) });
  if (error || !data) return null;
  return data as PortalView;
}

/** Whether the booking's agency has connected Razorpay, so the portal can offer "Pay securely". */
export async function portalPaymentsReady(token: string): Promise<boolean> {
  if (!isPortalToken(token)) return false;
  const admin = createAdminClient();
  if (!admin) return false;
  const { data } = await admin.rpc("portal_payments_ready", { p_hash: hashPortalToken(token) });
  return data === true;
}
