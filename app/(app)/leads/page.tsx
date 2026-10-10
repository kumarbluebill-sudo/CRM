import type { Metadata } from "next";
import Link from "next/link";
import { Plus, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { SegmentedTabs } from "@/components/crm/segmented-tabs";
import { StatusBadge } from "@/components/crm/status-badge";
import { LeadStatusSelect } from "@/components/crm/lead-status-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { requireOrgSession } from "@/lib/auth/session";
import { LEAD_STATUSES, label } from "@/lib/crm/constants";
import { listBoardLeads, listLeads } from "@/lib/crm/queries";
import type { LeadRow } from "@/lib/crm/types";

export const metadata: Metadata = { title: "Leads" };

type SearchParams = Promise<{ q?: string; status?: string; page?: string; view?: string }>;

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireOrgSession();
  const sp = await searchParams;
  const board = sp.view === "board";
  const canUpdate = session.permissions.has("leads.update");
  const canCreate = session.permissions.has("leads.create");

  if (!session.permissions.has("leads.view")) {
    return (
      <EmptyState
        icon={UserPlus}
        title="No access"
        description="You don't have permission to view leads."
      />
    );
  }

  const status = LEAD_STATUSES.find((s) => s === sp.status);
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;
  const list = board ? null : await listLeads({ q: sp.q, status, page });
  const boardLeads = board ? await listBoardLeads(sp.q) : [];

  const viewLink = (view: string) =>
    `/leads?view=${view}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Leads"
        description="Track enquiries from first contact to confirmed booking."
        actions={
          <>
            <SegmentedTabs
              label="View"
              items={[
                { label: "List", href: viewLink("list"), active: !board },
                { label: "Board", href: viewLink("board"), active: board },
              ]}
            />
            {canCreate && (
              <Button size="sm" nativeButton={false} render={<Link href="/leads/new" />}>
                <Plus className="size-4" aria-hidden /> New lead
              </Button>
            )}
          </>
        }
      />

      <form className="flex flex-wrap gap-2" role="search">
        <input type="hidden" name="view" value={board ? "board" : "list"} />
        <Input
          name="q"
          defaultValue={sp.q}
          placeholder="Search title or destination…"
          className="max-w-xs"
          aria-label="Search leads"
        />
        {!board && (
          <select
            name="status"
            defaultValue={status ?? ""}
            aria-label="Filter by stage"
            className="border-input bg-background h-8 rounded-lg border px-2.5 text-sm"
          >
            <option value="">All stages</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        )}
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>

      {board ? (
        <section aria-label="Pipeline board" className="flex gap-3 overflow-x-auto pb-3">
          {LEAD_STATUSES.map((s) => {
            const items = boardLeads.filter((l) => l.status === s);
            return (
              <div key={s} className="bg-muted flex w-64 shrink-0 flex-col gap-2 rounded-xl p-2.5">
                <h2 className="flex items-center gap-2 px-0.5 text-[13px] font-semibold">
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ background: `var(--chart-${(LEAD_STATUSES.indexOf(s) % 5) + 1})` }}
                  />
                  {label(s)}{" "}
                  <span className="text-muted-foreground font-normal">{items.length}</span>
                </h2>
                {items.map((l) => (
                  <BoardCard key={l.id} lead={l} canUpdate={canUpdate} />
                ))}
                {items.length === 0 && (
                  <p className="text-muted-foreground px-1 py-4 text-center text-xs">No leads</p>
                )}
              </div>
            );
          })}
        </section>
      ) : list && list.rows.length > 0 ? (
        <>
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3">Lead</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Travel</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((l) => (
                    <tr key={l.id} className="hover:bg-muted/50 border-b last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                          {l.title}
                        </Link>
                        <p className="text-muted-foreground text-xs">{l.destination ?? "—"}</p>
                      </td>
                      <td className="px-4 py-3">{l.customers?.name ?? "—"}</td>
                      <td className="px-4 py-3">{l.departure_date ?? "—"}</td>
                      <td className="px-4 py-3">
                        <StatusBadge value={l.priority} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge value={l.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <ul className="flex flex-col gap-3 md:hidden">
            {list.rows.map((l) => (
              <li key={l.id}>
                <Card size="sm">
                  <CardContent className="flex flex-col gap-2">
                    <Link href={`/leads/${l.id}`} className="font-medium">
                      {l.title}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {l.destination ?? "—"} · {l.customers?.name ?? "No customer"}
                    </p>
                    <div className="flex gap-2">
                      <StatusBadge value={l.status} />
                      <StatusBadge value={l.priority} />
                    </div>
                    {l.customers?.phone && (
                      <a
                        href={`tel:${l.customers.phone}`}
                        className="text-primary text-sm underline"
                      >
                        Call {l.customers.phone}
                      </a>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination
            page={list.page}
            total={list.total}
            basePath="/leads"
            params={{ q: sp.q, status, view: "list" }}
          />
        </>
      ) : (
        !board && (
          <Card>
            <CardContent>
              <EmptyState
                icon={UserPlus}
                title={sp.q || status ? "No leads match your filters" : "No leads yet"}
                description={
                  canCreate ? "Create your first lead to start the pipeline." : undefined
                }
              />
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}

function BoardCard({ lead, canUpdate }: { lead: LeadRow; canUpdate: boolean }) {
  return (
    <Card size="sm" className="hover:border-input rounded-[10px] shadow-xs">
      <CardContent className="flex flex-col gap-2">
        <Link
          href={`/leads/${lead.id}`}
          className="text-sm leading-snug font-medium hover:underline"
        >
          {lead.title}
        </Link>
        <p className="text-muted-foreground text-xs">
          {lead.destination ?? "—"}
          {lead.customers?.name ? ` · ${lead.customers.name}` : ""}
        </p>
        <StatusBadge value={lead.priority} />
        <LeadStatusSelect leadId={lead.id} status={lead.status} disabled={!canUpdate} />
      </CardContent>
    </Card>
  );
}
