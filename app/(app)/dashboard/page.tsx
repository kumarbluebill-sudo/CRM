import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CreditCard, Inbox, Plus, UserPlus } from "lucide-react";
import { StatusBadge } from "@/components/crm/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { getDashboardStats } from "@/lib/crm/queries";
import { getWorkQueue } from "@/lib/visa/queries";

export const metadata: Metadata = { title: "Dashboard" };

// Metrics for modules that are not built yet render as "—" rather than fake numbers.
const PENDING_METRICS = ["Quotes", "Revenue", "Outstanding"] as const;

export default async function DashboardPage() {
  const session = await requireOrgSession();
  const canLeads = session.permissions.has("leads.view");
  const stats = canLeads ? await getDashboardStats() : null;
  const visa = session.permissions.has("visa.view")
    ? await getWorkQueue(true).catch(() => null)
    : null;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = session.fullName.split(" ")[0] || "there";
  const today = new Intl.DateTimeFormat("en-IN", { dateStyle: "full" }).format(new Date());

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting}, {firstName}
          </h1>
          <p className="text-muted-foreground text-sm">
            {session.organization.name} · {today}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {session.permissions.has("leads.create") && (
            <Button size="sm" nativeButton={false} render={<Link href="/leads/new" />}>
              <Plus className="size-4" aria-hidden /> New Lead
            </Button>
          )}
          {session.permissions.has("customers.create") && (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/customers/new" />}
            >
              <Plus className="size-4" aria-hidden /> New Customer
            </Button>
          )}
          {session.permissions.has("itineraries.create") && (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/itineraries/new" />}
            >
              <Plus className="size-4" aria-hidden /> Create Itinerary
            </Button>
          )}
          {["New Quotation"].map((l) => (
            <Button key={l} size="sm" variant="outline" disabled title="Available in a later phase">
              <Plus className="size-4" aria-hidden /> {l}
            </Button>
          ))}
        </div>
      </div>

      <section
        aria-label="Key metrics"
        className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"
      >
        <Metric label="New Leads" value={stats ? String(stats.newLeads) : "—"} />
        <Metric label="Hot Leads" value={stats ? String(stats.hotLeads) : "—"} />
        <Metric label="Bookings" value={stats ? String(stats.openBookings) : "—"} />
        {PENDING_METRICS.map((m) => (
          <Metric key={m} label={m} value="—" />
        ))}
      </section>

      {visa && (
        <section aria-label="Visa work" className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {(
            [
              ["Visa documents to review", visa.counts.review],
              ["Ready to submit", visa.counts.toSubmit],
              ["Overdue visas", visa.counts.overdue],
              ["Visas to deliver", visa.counts.toDeliver],
            ] as const
          ).map(([label, n]) => (
            <Link key={label} href="/visa/queue">
              <Metric label={label} value={String(n)} />
            </Link>
          ))}
        </section>
      )}

      <section aria-label="Activity" className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Today&apos;s Follow-ups</CardTitle>
          </CardHeader>
          <CardContent>
            {stats && stats.followups.length > 0 ? (
              <ul className="flex flex-col gap-2 text-sm">
                {stats.followups.map((f) => (
                  <li key={f.id} className="flex justify-between gap-2">
                    <span>{f.title}</span>
                    <span className="text-muted-foreground">{f.due_date}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={CalendarClock} title="No follow-ups due" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Leads</CardTitle>
          </CardHeader>
          <CardContent>
            {stats && stats.recentLeads.length > 0 ? (
              <ul className="flex flex-col gap-2 text-sm">
                {stats.recentLeads.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <Link href={`/leads/${l.id}`} className="hover:underline">
                      {l.title}
                    </Link>
                    <StatusBadge value={l.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={UserPlus} title="No leads yet" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming Trips</CardTitle>
          </CardHeader>
          <CardContent>
            {stats && stats.upcomingTrips.length > 0 ? (
              <ul className="flex flex-col gap-2 text-sm">
                {stats.upcomingTrips.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <Link href={`/bookings/${t.id}`} className="hover:underline">
                      {t.title}
                    </Link>
                    <span className="text-muted-foreground">{t.travel_start ?? "TBD"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Inbox} title="No upcoming trips" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState icon={CreditCard} title="Coming with payments" />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-muted-foreground text-xs font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
