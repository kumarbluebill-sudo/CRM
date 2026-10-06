import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { StatusBadge } from "@/components/crm/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { BOOKING_STATUSES } from "@/lib/booking/schema";
import { listBookings } from "@/lib/booking/queries";
import { formatMoney } from "@/lib/quotation/pricing";

export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("bookings.view")) {
    return (
      <EmptyState
        icon={Briefcase}
        title="No access"
        description="You don't have permission to view bookings."
      />
    );
  }
  const sp = await searchParams;
  const status = BOOKING_STATUSES.find((s) => s === sp.status);
  const { rows, total, page } = await listBookings({
    q: sp.q,
    status,
    page: Number.parseInt(sp.page ?? "1", 10) || 1,
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Bookings"
        description="Confirmed trips: passengers, suppliers, vouchers and documents. Create a booking from an approved quotation."
        actions={
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href="/quotations?status=APPROVED" />}
          >
            Approved quotations
          </Button>
        }
      />
      <form className="flex flex-wrap gap-2" role="search">
        <Input
          name="q"
          defaultValue={sp.q}
          placeholder="Search number, title or destination…"
          className="max-w-xs"
          aria-label="Search bookings"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          aria-label="Filter by status"
          className="border-input bg-background h-8 rounded-lg border px-2.5 text-sm"
        >
          <option value="">All statuses</option>
          {BOOKING_STATUSES.map((s) => (
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
              icon={Briefcase}
              title={sp.q || status ? "No bookings match" : "No bookings yet"}
              description="Approve a quotation, then convert it to a booking."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {rows.map((b) => (
              <li key={b.id}>
                <Card size="sm">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/bookings/${b.id}`} className="font-medium hover:underline">
                        {b.title}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {b.booking_number} · {b.customers?.name ?? "—"}
                        {b.destination ? ` · ${b.destination}` : ""}
                        {b.travel_start ? ` · ${b.travel_start}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm">
                        <span className="font-medium">
                          {formatMoney(Number(b.total_amount), b.currency)}
                        </span>
                        {Number(b.balance_amount) > 0 && (
                          <span className="text-muted-foreground block text-xs">
                            Balance {formatMoney(Number(b.balance_amount), b.currency)}
                          </span>
                        )}
                      </span>
                      <StatusBadge value={b.status} />
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination page={page} total={total} basePath="/bookings" params={{ q: sp.q, status }} />
        </>
      )}
    </div>
  );
}
