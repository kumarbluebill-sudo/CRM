import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Search" };

type Hit = { type: string; id: string; title: string; subtitle: string | null };

const GROUPS: Record<string, { label: string; href: (id: string) => string }> = {
  customer: { label: "Customers", href: (id) => `/customers/${id}` },
  booking: { label: "Bookings", href: (id) => `/bookings/${id}` },
  lead: { label: "Enquiries", href: (id) => `/leads/${id}` },
  quotation: { label: "Quotations", href: (id) => `/quotations/${id}` },
  visa: { label: "Visa applications", href: (id) => `/visa/applications/${id}` },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 60);
  let hits: Hit[] = [];
  if (q.length >= 2) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("global_search", { p_q: q });
    hits = (data ?? []) as Hit[];
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Search"
        description={q ? `Results for “${q}”` : "Type at least two characters in the search box."}
      />
      {q.length >= 2 && hits.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matches"
          description="Try a name, phone number, booking number or application number."
        />
      ) : (
        Object.entries(GROUPS).map(([type, g]) => {
          const rows = hits.filter((h) => h.type === type);
          if (rows.length === 0) return null;
          return (
            <Card key={type}>
              <CardContent>
                <h2 className="pb-2 text-sm font-semibold">{g.label}</h2>
                <ul className="divide-y text-sm">
                  {rows.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center gap-3 py-2">
                      <Link href={g.href(h.id)} className="font-medium hover:underline">
                        {h.title}
                      </Link>
                      {h.subtitle && <span className="text-muted-foreground">{h.subtitle}</span>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
