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
import { parseRange, presetRanges } from "@/lib/reports/range";
import { getVisaReport } from "@/lib/visa/queries";

export const metadata: Metadata = { title: "Visa reports" };

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

export default async function VisaReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("visa.report.view")) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No access"
        description="You don't have permission to view visa reports."
      />
    );
  }
  const sp = await searchParams;
  const range = parseRange(sp.from, sp.to);
  const [r, team] = await Promise.all([getVisaReport(range), listTeamMembers()]);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const qs = `from=${range.from}&to=${range.to}`;
  const a = r.applications;
  const decided = a.approved + a.rejected;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Visa reports"
        description={`Applications created ${range.from} to ${range.to}`}
      />

      <form className="flex flex-wrap items-end gap-3" role="search" aria-label="Date range">
        {(["from", "to"] as const).map((n) => (
          <label key={n} className="flex flex-col gap-1 text-xs">
            {n === "from" ? "From" : "To"}
            <input
              type="date"
              name={n}
              defaultValue={range[n]}
              className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
            />
          </label>
        ))}
        <Button type="submit" size="sm">
          Apply
        </Button>
        <span className="flex flex-wrap gap-2 text-sm">
          {presetRanges().map((p) => (
            <Link
              key={p.label}
              href={`/visa/reports?from=${p.from}&to=${p.to}`}
              className="text-primary underline"
            >
              {p.label}
            </Link>
          ))}
        </span>
      </form>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Download CSV:</span>
        {[
          ["applications", "Applications"],
          ["enquiries", "Enquiries"],
          ...(session.permissions.has("visa.supplier.view")
            ? [["suppliers", "Supplier submissions"]]
            : []),
        ].map(([type, text]) => (
          <Button
            key={type}
            size="xs"
            variant="outline"
            nativeButton={false}
            render={<a href={`/api/visa/export?type=${type}&${qs}`} />}
          >
            <Download className="size-3" aria-hidden /> {text}
          </Button>
        ))}
      </div>

      <section
        aria-label="Key figures"
        className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6"
      >
        <Stat title="Applications" value={String(a.created)} />
        <Stat
          title="Approved"
          value={String(a.approved)}
          note={`${pct(a.approved, decided)} of decided`}
        />
        <Stat
          title="Rejected"
          value={String(a.rejected)}
          note={`${pct(a.rejected, decided)} of decided`}
        />
        <Stat title="Delivered" value={String(a.delivered)} />
        <Stat title="Still open" value={String(a.open)} />
        <Stat title="Cancelled" value={String(a.cancelled)} />
        <Stat
          title="Enquiries converted"
          value={`${r.enquiries.converted} / ${r.enquiries.created}`}
          note={`${pct(r.enquiries.converted, r.enquiries.created)} conversion`}
        />
        <Stat title="Enquiries lost" value={String(r.enquiries.lost)} />
        <Stat title="Overdue now" value={String(r.pending.overdue)} />
        <Stat title="Documents pending now" value={String(r.pending.documentsPending)} />
        <Stat title="Travel within 7 days, not submitted" value={String(r.pending.travelRisk)} />
        {r.revenue?.map((v) => (
          <Stat
            key={v.currency}
            title={`Quoted value (${v.currency})`}
            value={formatMoney(Number(v.value), v.currency)}
            note={`${v.count} priced application(s)`}
          />
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By country</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars
              rows={a.byCountry.map((c) => ({
                label: c.country,
                value: c.count,
                text: `${c.count} · ${c.approved} approved · ${c.rejected} rejected`,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By visa type</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars
              rows={a.byType.map((t) => ({
                label: label(t.type),
                value: t.count,
                text: String(t.count),
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By processor</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars
              rows={a.byStaff.map((s) => ({
                label: s.userId ? (names.get(s.userId) ?? "Former staff") : "Unassigned",
                value: s.count,
                text: `${s.count} · ${s.approved} approved · ${s.rejected} rejected`,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By status</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars
              rows={Object.entries(a.byStatus).map(([s, n]) => ({
                label: label(s),
                value: n,
                text: String(n),
              }))}
            />
          </CardContent>
        </Card>
      </div>

      {r.profit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue and cost</CardTitle>
            <p className="text-muted-foreground text-xs">
              Only applications with a recorded supplier cost are included, so missing costs never
              inflate the margin.
            </p>
          </CardHeader>
          <CardContent>
            {r.profit.length === 0 ? (
              <p className="text-muted-foreground text-sm">No costs recorded in this range.</p>
            ) : (
              <ul className="divide-y text-sm">
                {r.profit.map((p) => (
                  <li key={p.currency} className="flex flex-wrap gap-4 py-2">
                    <span className="font-medium">{p.currency}</span>
                    <span>Revenue {formatMoney(Number(p.revenue), p.currency)}</span>
                    <span>Cost {formatMoney(Number(p.cost), p.currency)}</span>
                    <span className="font-medium">
                      Margin {formatMoney(Number(p.revenue) - Number(p.cost), p.currency)} (
                      {pct(Number(p.revenue) - Number(p.cost), Number(p.revenue))})
                    </span>
                    <span className="text-muted-foreground">{p.applications} application(s)</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {r.suppliers && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Supplier performance</CardTitle>
          </CardHeader>
          <CardContent>
            {r.suppliers.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No supplier submissions in this range.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {r.suppliers.map((s) => (
                  <li key={s.supplier} className="flex flex-wrap gap-4 py-2">
                    <span className="min-w-40 font-medium">{s.supplier}</span>
                    <span>{s.submissions} submitted</span>
                    <span>{s.completed} completed</span>
                    <span>
                      {s.avgDays != null ? `${s.avgDays} days average` : "no completions yet"}
                    </span>
                    <span className={s.overdue > 0 ? "text-tone-bad" : ""}>{s.overdue} overdue</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
