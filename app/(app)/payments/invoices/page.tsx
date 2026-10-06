import type { Metadata } from "next";
import Link from "next/link";
import { Download, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { StatusBadge } from "@/components/crm/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { listInvoices } from "@/lib/payments/queries";
import { formatMoney } from "@/lib/quotation/pricing";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("payments.view")) {
    return (
      <EmptyState
        icon={ScrollText}
        title="No access"
        description="You don't have permission to view invoices."
      />
    );
  }
  const sp = await searchParams;
  const { rows, total, page } = await listInvoices(Number.parseInt(sp.page ?? "1", 10) || 1);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Invoices"
        description="Issue invoices from a booking's Payments section."
      />
      <Card>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No invoices yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {rows.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-28 font-medium">{i.invoice_number}</span>
                  <Link href={`/bookings/${i.booking_id}`} className="hover:underline">
                    {i.bookings?.booking_number}
                  </Link>
                  <span className="text-muted-foreground">{i.issue_date}</span>
                  <span>{formatMoney(Number(i.total_amount), i.currency)}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <StatusBadge value={i.status} />
                    <Button
                      size="xs"
                      variant="outline"
                      nativeButton={false}
                      render={
                        <a
                          href={`/api/invoices/${i.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                    >
                      <Download className="size-3" aria-hidden /> PDF
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pagination page={page} total={total} basePath="/payments/invoices" params={{}} />
    </div>
  );
}
