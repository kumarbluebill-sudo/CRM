import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/datetime/local-time";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Agencies" };

type Row = {
  id: string;
  name: string;
  plan: string | null;
  subscription: string | null;
  periodEnd: string | null;
  graceEnds: string | null;
  seats: number;
  failedPayments: number;
  lastPaid: string | null;
};

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePlatformAdmin();
  const q = ((await searchParams).q ?? "").slice(0, 60);
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_organizations", {
    p_search: q || null,
    p_limit: 100,
    p_offset: 0,
  });
  const rows = (data ?? []) as Row[];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Agencies" description="Every agency, its plan and payment health." />
      <form role="search" className="flex max-w-sm gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search by agency name"
          aria-label="Search agencies"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-4 py-2.5">Agency</th>
                <th className="px-4 py-2.5">Plan</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Staff</th>
                <th className="px-4 py-2.5">Renews / ends</th>
                <th className="px-4 py-2.5">Last paid</th>
                <th className="px-4 py-2.5 text-right">Failed payments</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/organizations/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{r.plan ?? "–"}</td>
                  <td className="px-4 py-2.5">
                    {r.subscription ? <StatusBadge value={r.subscription} /> : "–"}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{r.seats}</td>
                  <td className="px-4 py-2.5">
                    {r.periodEnd ? <LocalTime value={r.periodEnd} dateOnly /> : "–"}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.lastPaid ? <LocalTime value={r.lastPaid} dateOnly /> : "–"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.failedPayments}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted-foreground px-4 py-8 text-center">
                    No agencies found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
