import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { StatusBadge } from "@/components/crm/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { listQuotations } from "@/lib/quotation/queries";
import { formatMoney } from "@/lib/quotation/pricing";
import { QUOTATION_STATUSES } from "@/lib/quotation/schema";

export const metadata: Metadata = { title: "Quotations" };

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("quotes.view")) {
    return (
      <EmptyState
        icon={FileText}
        title="No access"
        description="You don't have permission to view quotations."
      />
    );
  }
  const sp = await searchParams;
  const status = QUOTATION_STATUSES.find((s) => s === sp.status);
  const { rows, total, page } = await listQuotations({
    q: sp.q,
    status,
    page: Number.parseInt(sp.page ?? "1", 10) || 1,
  });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Quotations"
        description="Prepare, send and track customer quotes."
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/quotations/templates" />}
            >
              Templates
            </Button>
            {session.permissions.has("quotes.create") && (
              <Button size="sm" nativeButton={false} render={<Link href="/quotations/new" />}>
                <Plus className="size-4" aria-hidden /> New quotation
              </Button>
            )}
          </>
        }
      />
      <form className="flex flex-wrap gap-2" role="search">
        <Input
          name="q"
          defaultValue={sp.q}
          placeholder="Search number or title…"
          className="max-w-xs"
          aria-label="Search quotations"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          aria-label="Filter by status"
          className="border-input bg-background h-8 rounded-lg border px-2.5 text-sm"
        >
          <option value="">All statuses</option>
          {QUOTATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>
      {rows.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={FileText}
              title={sp.q || status ? "No quotations match" : "No quotations yet"}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {rows.map((r) => {
              const overdue =
                ["SENT", "VIEWED"].includes(r.status) &&
                r.valid_until !== null &&
                r.valid_until < today;
              return (
                <li key={r.id}>
                  <Card size="sm">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/quotations/${r.id}`} className="font-medium hover:underline">
                          {r.title}
                        </Link>
                        <p className="text-muted-foreground text-xs">
                          {r.quotation_number} · {r.customers?.name ?? "—"}
                          {r.valid_until ? ` · valid until ${r.valid_until}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {r.selected_total !== null && (
                          <span className="text-sm font-medium">
                            {formatMoney(r.selected_total, r.currency)}
                          </span>
                        )}
                        {overdue && (
                          <span className="text-destructive text-xs font-medium">
                            Past validity
                          </span>
                        )}
                        <StatusBadge value={r.status} />
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
          <Pagination
            page={page}
            total={total}
            basePath="/quotations"
            params={{ q: sp.q, status }}
          />
        </>
      )}
    </div>
  );
}
