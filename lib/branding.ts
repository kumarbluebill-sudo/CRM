import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type OrgBrand = { name: string; logo: string | null };

/**
 * The agency's display identity for the shell: trade name, else legal name, else the organization name, plus the logo
 * data URI if one is set. One cached read per request, shared by the sidebar, header and mobile menu.
 */
export const getOrgBrand = cache(async (fallbackName: string): Promise<OrgBrand> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organization_branding")
    .select("logo_data, trade_name, legal_name")
    .maybeSingle();
  return {
    name:
      (data?.trade_name as string | null) || (data?.legal_name as string | null) || fallbackName,
    logo: (data?.logo_data as string | null) ?? null,
  };
});
