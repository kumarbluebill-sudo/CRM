import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { OrgLimits, OrgUsage } from "@/lib/billing/limits";

export type PlanRow = {
  key: string;
  name: string;
  price_paise: number;
  currency: string;
  limits: OrgLimits["limits"];
  purchasable: boolean;
  description: string | null;
  features: string[];
  contactSales: boolean;
};

export type BillingHistory = {
  payments: {
    id: string;
    status: "CAPTURED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
    amountPaise: number;
    refundedPaise: number;
    currency: string;
    plan: string | null;
    at: string;
    receiptId: string | null;
    receiptNumber: string | null;
  }[];
  events: { kind: string; from: string | null; to: string | null; at: string }[];
};

export async function getBillingHistory(): Promise<BillingHistory | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("org_billing_history");
  return error ? null : (data as BillingHistory);
}

/** Cached per request so the layout banner and the page share one lookup. */
export const getOrgLimits = cache(async (): Promise<OrgLimits | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("org_limits");
  return error ? null : (data as OrgLimits | null);
});

export async function getOrgUsage(): Promise<OrgUsage | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("org_usage");
  return error ? null : (data as OrgUsage | null);
}

export async function listPlans(): Promise<PlanRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("plans")
    .select(
      "key, name, price_paise, currency, limits, razorpay_plan_id, description, features, contact_sales",
    )
    .order("sort");
  if (error) throw error;
  return (data ?? []).map((p) => ({
    key: p.key as string,
    name: p.name as string,
    price_paise: p.price_paise as number,
    currency: p.currency as string,
    limits: p.limits as OrgLimits["limits"],
    // The Razorpay plan id itself isn't exposed to the browser; only whether checkout is possible.
    purchasable: Boolean(p.razorpay_plan_id) && (p.price_paise as number) > 0,
    description: (p.description as string | null) ?? null,
    features: Array.isArray(p.features) ? (p.features as string[]) : [],
    contactSales: Boolean(p.contact_sales),
  }));
}
