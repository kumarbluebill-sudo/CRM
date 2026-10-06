import type { Metadata } from "next";
import Link from "next/link";
import { Download, Receipt } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { listPayments } from "@/lib/payments/queries";
import { formatMoney } from "@/lib/quotation/pricing";

export const metadata: Metadata = { title: "Receipts" };

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("payments.view")) {
    return (
      <EmptyState
        icon={Receipt}
        title="No access"
        description="You don't have permission to view receipts."
      />
    );
  }
  const sp = await searchParams;
  const { rows, total, page } = await listPayments({
    receiptsOnly: true,
    page: Number.parseInt(sp.page ?? "1", 10) || 1,
  });
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader title="Receipts" description="One receipt for every payment received." />
      <Card>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No receipts yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {rows.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-28 font-medium">{p.receipt_number}</span>
                  <Link href={`/bookings/${p.booking_id}`} className="hover:underline">
                    {p.bookings?.booking_number}
                  </Link>
                  <span>{formatMoney(Number(p.amount), p.currency)}</span>
                  <span className="text-muted-foreground">{label(p.method)}</span>
                  <span className="text-muted-foreground">{String(p.paid_at).slice(0, 10)}</span>
                  <span className="ml-auto">
                    <Button
                      size="xs"
                      variant="outline"
                      nativeButton={false}
                      render={
                        <a
                          href={`/api/payments/${p.id}/receipt`}
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
      <Pagination page={page} total={total} basePath="/payments/receipts" params={{}} />
    </div>
  );
}
