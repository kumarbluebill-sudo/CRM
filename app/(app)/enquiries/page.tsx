import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { StatusBadge } from "@/components/crm/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { listEnquiries, listTeamMembers } from "@/lib/crm/queries";
import { ENQUIRY_STATUSES } from "@/lib/crm/schemas";

export const metadata: Metadata = { title: "Enquiries" };

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("leads.view")) {
    return (
      <EmptyState
        icon={MessageSquareText}
        title="No access"
        description="You don't have permission to view enquiries."
      />
    );
  }
  const sp = await searchParams;
  const status = ENQUIRY_STATUSES.find((s) => s === sp.status);
  const [list, team] = await Promise.all([
    listEnquiries({ q: sp.q, status, page: Number.parseInt(sp.page ?? "1", 10) || 1 }),
    listTeamMembers(),
  ]);
  const nameOf = (id: string | null) => team.find((m) => m.userId === id)?.name ?? "—";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Enquiries"
        description="What customers have asked for. One lead can have several enquiries; add them on the lead's Enquiry History tab."
      />
      <form className="flex flex-wrap gap-2" role="search">
        <Input
          name="q"
          defaultValue={sp.q}
          placeholder="Search enquiry number or destination…"
          className="max-w-xs"
          aria-label="Search enquiries"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          aria-label="Filter by status"
          className="border-input bg-background h-8 rounded-lg border px-2.5 text-sm"
        >
          <option value="">All statuses</option>
          {ENQUIRY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>
      {list.rows.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={MessageSquareText}
              title={sp.q || status ? "No enquiries match your filters" : "No enquiries yet"}
              description="Open a lead and add an enquiry on its Enquiry History tab."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                  <tr>
                    <th className="px-3 py-3">Enquiry</th>
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3">Lead</th>
                    <th className="px-3 py-3">Destination</th>
                    <th className="px-3 py-3">Travellers</th>
                    <th className="px-3 py-3">Assigned</th>
                    <th className="px-3 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/50 border-b last:border-0">
                      <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
                        {e.enquiry_number}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{e.enquiry_date}</td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/leads/${e.lead_id}?tab=enquiries`}
                          className="font-medium hover:underline"
                        >
                          {e.leads?.contact_name ?? e.leads?.title ?? "Lead"}
                        </Link>
                        <p className="text-muted-foreground font-mono text-xs">
                          {e.leads?.reference_number}
                        </p>
                      </td>
                      <td className="px-3 py-3">{e.destination ?? "—"}</td>
                      <td className="px-3 py-3">{e.travellers ?? "—"}</td>
                      <td className="px-3 py-3">{nameOf(e.assigned_user_id)}</td>
                      <td className="px-3 py-3">
                        <StatusBadge value={e.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <Pagination
            page={list.page}
            total={list.total}
            basePath="/enquiries"
            params={{ q: sp.q, status }}
          />
        </>
      )}
    </div>
  );
}
