import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareText, Plus } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { StatusBadge } from "@/components/crm/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { listTeamMembers } from "@/lib/crm/queries";
import { ENQUIRY_STATUSES } from "@/lib/visa/constants";
import { listEnquiries } from "@/lib/visa/queries";

export const metadata: Metadata = { title: "Visa enquiries" };

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; assigned?: string; page?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("visa.view")) {
    return (
      <EmptyState
        icon={MessageSquareText}
        title="No access"
        description="You don't have permission to view visa enquiries."
      />
    );
  }
  const sp = await searchParams;
  const status = ENQUIRY_STATUSES.find((s) => s === sp.status);
  const [{ rows, total, page }, team] = await Promise.all([
    listEnquiries({
      q: sp.q,
      status,
      assigned: sp.assigned,
      page: Number.parseInt(sp.page ?? "1", 10) || 1,
    }),
    listTeamMembers(),
  ]);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const select =
    "border-input bg-background focus-visible:ring-ring/50 h-8 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Visa enquiries"
        description="Customer visa questions, before they become applications."
        actions={
          session.permissions.has("visa.create") && (
            <Button size="sm" nativeButton={false} render={<Link href="/visa/enquiries/new" />}>
              <Plus className="size-4" aria-hidden /> New enquiry
            </Button>
          )
        }
      />
      <form className="flex flex-wrap gap-2" role="search">
        <Input
          name="q"
          defaultValue={sp.q}
          placeholder="Search number or customer…"
          className="max-w-xs"
          aria-label="Search enquiries"
        />
        <select name="status" defaultValue={status ?? ""} className={select} aria-label="Status">
          <option value="">All statuses</option>
          {ENQUIRY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <select
          name="assigned"
          defaultValue={sp.assigned ?? ""}
          className={select}
          aria-label="Assigned to"
        >
          <option value="">Anyone</option>
          {team.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title="No visa enquiries found"
          description="Try a different filter, or add a new enquiry."
        />
      ) : (
        <Card>
          <CardContent>
            <ul className="divide-y text-sm">
              {rows.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <Link
                    href={`/visa/enquiries/${e.id}`}
                    className="min-w-36 font-medium hover:underline"
                  >
                    {e.enquiry_number}
                  </Link>
                  <span>{e.customers?.name}</span>
                  <span className="text-muted-foreground">
                    {e.visa_countries?.name ?? "Destination not set"}
                    {e.travel_date ? ` · ${e.travel_date}` : ""} · {e.travellers} traveller
                    {e.travellers === 1 ? "" : "s"}
                  </span>
                  <span className="text-muted-foreground">
                    {e.assigned_to ? (names.get(e.assigned_to) ?? "") : "Unassigned"}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {(e.priority === "URGENT" || e.priority === "HIGH") && (
                      <StatusBadge value={e.priority} />
                    )}
                    <StatusBadge value={e.status} />
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Pagination
        page={page}
        total={total}
        basePath="/visa/enquiries"
        params={{ q: sp.q, status, assigned: sp.assigned }}
      />
    </div>
  );
}
