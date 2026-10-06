import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { StatusBadge } from "@/components/crm/status-badge";
import { RemindersButton } from "@/components/payments/payment-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { listDueSchedules, listPayments } from "@/lib/payments/queries";
import { formatMoney } from "@/lib/quotation/pricing";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("payments.view")) {
    return (
      <EmptyState
        icon={CreditCard}
        title="No access"
        description="You don't have permission to view payments."
      />
    );
  }
  const sp = await searchParams;
  const [{ rows, total, page }, due] = await Promise.all([
    listPayments({ page: Number.parseInt(sp.page ?? "1", 10) || 1 }),
    listDueSchedules(7),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Payments"
        description="Money received, and instalments that are overdue or due this week."
        actions={session.permissions.has("payments.create") && <RemindersButton />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overdue and due soon</CardTitle>
        </CardHeader>
        <CardContent>
          {due.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing is due.</p>
          ) : (
            <ul className="divide-y text-sm">
              {due.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                  <Link href={`/bookings/${s.booking_id}`} className="font-medium hover:underline">
                    {s.booking_number}
                  </Link>
                  <span>{s.label}</span>
                  <span className="text-muted-foreground">Due {s.due_date}</span>
                  <span className="ml-auto">
                    {formatMoney(Number(s.amount) - Number(s.covered), s.currency)}
                  </span>
                  <StatusBadge value={s.schedule_status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All payments</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No payments yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {rows.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
                  <Link href={`/bookings/${p.booking_id}`} className="font-medium hover:underline">
                    {p.bookings?.booking_number ?? "Booking"}
                  </Link>
                  <span>{formatMoney(Number(p.amount), p.currency)}</span>
                  <span className="text-muted-foreground">{label(p.method)}</span>
                  <span className="text-muted-foreground">
                    {(p.paid_at ?? p.created_at).slice(0, 10)}
                  </span>
                  <span className="ml-auto">
                    <StatusBadge value={p.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pagination page={page} total={total} basePath="/payments" params={{}} />
    </div>
  );
}
