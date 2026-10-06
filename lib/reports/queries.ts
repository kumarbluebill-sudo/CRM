import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Range } from "@/lib/reports/range";

type Money = { currency: string; amount?: number; value?: number; count?: number };

export type Report = {
  pipeline?: {
    leadsCreated: number;
    byStatus: Record<string, number>;
    bySource: { source: string; count: number }[];
    byAssignee: { userId: string | null; leads: number; won: number }[];
  };
  quotations?: {
    created: number;
    sent: number;
    approved: number;
    rejected: number;
    converted: number;
  };
  bookings?: {
    created: number;
    cancelled: number;
    value: Money[];
    byMonth: { month: string; currency: string; count: number; value: number }[];
    topDestinations: { destination: string; count: number }[];
  };
  collections?: {
    collected: Money[];
    byMonth: { month: string; currency: string; amount: number }[];
    byMethod: { method: string; currency: string; amount: number }[];
    outstanding: Money[];
    aging: {
      bucket: "NOT_DUE" | "D1_30" | "D31_60" | "D60_PLUS";
      currency: string;
      amount: number;
      count: number;
    }[];
  };
};

/** RLS-scoped in the database: only sections and rows the caller may see come back. */
export async function getReport(range: Range): Promise<Report> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_summary", {
    p_from: range.from,
    p_to: range.to,
  });
  if (error) throw error;
  return (data ?? {}) as Report;
}
