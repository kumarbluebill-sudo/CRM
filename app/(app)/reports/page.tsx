import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Download } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Bars } from "@/components/reports/bars";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { listTeamMembers } from "@/lib/crm/queries";
import { formatMoney } from "@/lib/quotation/pricing";
import { getReport } from "@/lib/reports/queries";
import { parseRange, presetRanges } from "@/lib/reports/range";

export const metadata: Metadata = { title: "Reports" };

const AGING_LABELS: Record<string, string> = {
  NOT_DUE: "Not yet due",
  D1_30: "1–30 days late",
  D31_60: "31–60 days late",
  D60_PLUS: "Over 60 days late",
};
const AGING_ORDER = ["NOT_DUE", "D1_30", "D31_60", "D60_PLUS"];
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");

function Stat({ title, value, note }: { title: string; value: string; note?: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-muted-foreground text-xs">{title}</p>
        <p className="text-xl font-semibold">{value}</p>
        {note && <p className="text-muted-foreground text-xs">{note}</p>}
      </CardContent>
    </Card>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("reports.view")) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No access"
        description="You don't have permission to view reports."
      />
    );
  }
  const sp = await searchParams;
  const range = parseRange(sp.from, sp.to);
  const [r, team] = await Promise.all([getReport(range), listTeamMembers()]);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const qs = `from=${range.from}&to=${range.to}`;
  const exports = [
    { type: "bookings", show: r.bookings, text: "Bookings" },
    { type: "payments", show: r.collections, text: "Payments" },
    { type: "leads", show: r.pipeline, text: "Leads" },
  ].filter((e) => e.show);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader title="Reports" description={`${range.from} to ${range.to}`} />

      <form className="flex flex-wrap items-end gap-3" role="search" aria-label="Date range">
        <label className="flex flex-col gap-1 text-xs">
          From
          <input
            type="date"
            name="from"
            defaultValue={range.from}
            className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          To
          <input
            type="date"
            name="to"
            defaultValue={range.to}
            className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
          />
        </label>
        <Button type="submit" size="sm">
          Apply
        </Button>
        <span className="flex flex-wrap gap-2 text-sm">
          {presetRanges().map((p) => (
            <Link
              key={p.label}
              href={`/reports?from=${p.from}&to=${p.to}`}
              className="text-primary underline"
            >
              {p.label}
            </Link>
          ))}
        </span>
      </form>

      {exports.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Download CSV:</span>
          {exports.map((e) => (
            <Button
              key={e.type}
              size="xs"
              variant="outline"
              nativeButton={false}
              render={<a href={`/api/reports/export?type=${e.type}&${qs}`} />}
            >
              <Download className="size-3" aria-hidden /> {e.text}
            </Button>
          ))}
        </div>
      )}

      {r.pipeline && (
        <section aria-label="Sales pipeline" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Sales pipeline</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat title="New leads" value={String(r.pipeline.leadsCreated)} />
            {r.quotations && (
              <>
                <Stat
                  title="Quotations sent"
                  value={String(r.quotations.sent)}
                  note={`${r.quotations.created} created`}
                />
                <Stat
                  title="Approved"
                  value={String(r.quotations.approved)}
                  note={`${pct(r.quotations.approved, r.quotations.sent)} of sent`}
                />
                <Stat
                  title="Converted to bookings"
                  value={String(r.quotations.converted)}
                  note={`${pct(r.quotations.converted, r.pipeline.leadsCreated)} of new leads`}
                />
              </>
            )}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Leads by status</CardTitle>
              </CardHeader>
              <CardContent>
                <Bars
                  rows={Object.entries(r.pipeline.byStatus)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => ({ label: label(k), value: v, text: String(v) }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Lead sources</CardTitle>
              </CardHeader>
              <CardContent>
                <Bars
                  rows={r.pipeline.bySource.map((s) => ({
                    label: s.source,
                    value: s.count,
                    text: String(s.count),
                  }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By team member</CardTitle>
              </CardHeader>
              <CardContent>
                <Bars
                  rows={r.pipeline.byAssignee.map((a) => ({
                    label: a.userId ? (names.get(a.userId) ?? "Former member") : "Unassigned",
                    value: a.leads,
                    text: `${a.leads} (${a.won} won)`,
                  }))}
                />
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {r.bookings && (
        <section aria-label="Bookings" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Bookings</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat title="Bookings created" value={String(r.bookings.created)} />
            <Stat title="Cancelled" value={String(r.bookings.cancelled)} />
            {r.bookings.value.map((v) => (
              <Stat
                key={v.currency}
                title={`Booked value (${v.currency})`}
                value={formatMoney(Number(v.value), v.currency)}
                note={`${v.count} booking${v.count === 1 ? "" : "s"}, excluding cancelled`}
              />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Booked value by month</CardTitle>
              </CardHeader>
              <CardContent>
                <Bars
                  rows={r.bookings.byMonth.map((m) => ({
                    label: `${m.month} · ${m.currency}`,
                    value: Number(m.value),
                    text: formatMoney(Number(m.value), m.currency),
                  }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top destinations</CardTitle>
              </CardHeader>
              <CardContent>
                <Bars
                  rows={r.bookings.topDestinations.map((d) => ({
                    label: d.destination,
                    value: d.count,
                    text: String(d.count),
                  }))}
                />
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {r.collections && (
        <section aria-label="Collections" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Collections</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {r.collections.collected.length === 0 && <Stat title="Collected" value="–" />}
            {r.collections.collected.map((c) => (
              <Stat
                key={c.currency}
                title={`Collected (${c.currency})`}
                value={formatMoney(Number(c.amount), c.currency)}
              />
            ))}
            {r.collections.outstanding.map((c) => (
              <Stat
                key={c.currency}
                title={`Outstanding now (${c.currency})`}
                value={formatMoney(Number(c.amount), c.currency)}
                note="Open bookings, all dates"
              />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Collected by month</CardTitle>
              </CardHeader>
              <CardContent>
                <Bars
                  rows={r.collections.byMonth.map((m) => ({
                    label: `${m.month} · ${m.currency}`,
                    value: Number(m.amount),
                    text: formatMoney(Number(m.amount), m.currency),
                  }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By payment method</CardTitle>
              </CardHeader>
              <CardContent>
                <Bars
                  rows={r.collections.byMethod.map((m) => ({
                    label: `${label(m.method)} · ${m.currency}`,
                    value: Number(m.amount),
                    text: formatMoney(Number(m.amount), m.currency),
                  }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Unpaid instalments by age</CardTitle>
              </CardHeader>
              <CardContent>
                <Bars
                  tone="warn"
                  rows={[...r.collections.aging]
                    .sort((a, b) => AGING_ORDER.indexOf(a.bucket) - AGING_ORDER.indexOf(b.bucket))
                    .map((a) => ({
                      label: `${AGING_LABELS[a.bucket]} · ${a.currency}`,
                      value: Number(a.amount),
                      text: `${formatMoney(Number(a.amount), a.currency)} (${a.count})`,
                    }))}
                />
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {!r.pipeline && !r.bookings && !r.collections && (
        <EmptyState
          icon={BarChart3}
          title="Nothing to show"
          description="Your role doesn't include any report sections."
        />
      )}
    </div>
  );
}
