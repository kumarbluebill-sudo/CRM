import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  BadgeIndianRupee,
  CalendarCheck,
  ClipboardList,
  Inbox,
  PlaneTakeoff,
  Stamp,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  CollectionBars,
  PipelineBar,
  HorizontalBars,
  RevenueArea,
  StatusDonut,
} from "@/components/dashboard/charts";
import { OpsTabs, type OpsTab } from "@/components/dashboard/ops-tabs";
import { Card } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { listTeamMembers } from "@/lib/crm/queries";
import { getJobsDashboard } from "@/lib/jobs/queries";
import { getDisplayPrefs } from "@/lib/datetime/prefs";
import { getDashboard, RANGE_LABELS, resolveRange, type Dashboard } from "@/lib/dashboard/queries";
import { formatMoney } from "@/lib/quotation/pricing";

export const metadata: Metadata = { title: "Dashboard" };

const RELATED: Record<string, (id: string) => string> = {
  LEAD: (id) => `/leads/${id}`,
  CUSTOMER: (id) => `/customers/${id}`,
  QUOTATION: (id) => `/quotations/${id}`,
  BOOKING: (id) => `/bookings/${id}`,
  VISA_APPLICATION: (id) => `/visa/applications/${id}`,
};
const related = (type: string | null, id: string | null) =>
  type && id && RELATED[type] ? RELATED[type](id) : "/tasks";

function Delta({ now, before }: { now: number; before?: number }) {
  if (!before) return null; // no reliable comparison: show nothing rather than a made-up change
  const pct = Math.round(((now - before) / before) * 100);
  const up = pct >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 text-xs font-medium ${up ? "bg-tone-ok-soft text-tone-ok" : "bg-tone-bad-soft text-tone-bad"}`}
      title="Compared with the previous period of the same length"
    >
      <Icon className="size-3" aria-hidden />
      {Math.abs(pct)}%<span className="sr-only"> {up ? "up" : "down"} on the previous period</span>
    </span>
  );
}

const KPI_STYLE: Record<string, { icon: LucideIcon; tone: string }> = {
  "Total Enquiries": { icon: Inbox, tone: "bg-tone-primary-soft text-tone-primary" },
  "Confirmed Bookings": { icon: CalendarCheck, tone: "bg-tone-ok-soft text-tone-ok" },
  "Upcoming Departures (30d)": { icon: PlaneTakeoff, tone: "bg-tone-info-soft text-tone-info" },
  "Revenue (bookings)": { icon: BadgeIndianRupee, tone: "bg-tone-violet-soft text-tone-violet" },
  Collected: { icon: Wallet, tone: "bg-tone-ok-soft text-tone-ok" },
  "Outstanding Payments": { icon: Wallet, tone: "bg-tone-warn-soft text-tone-warn" },
  "Pending Job Orders": { icon: ClipboardList, tone: "bg-tone-warn-soft text-tone-warn" },
  "Pending Visa Applications": { icon: Stamp, tone: "bg-tone-info-soft text-tone-info" },
  "Profit (costed bookings)": { icon: TrendingUp, tone: "bg-tone-ok-soft text-tone-ok" },
};

function Kpi({
  title,
  value,
  href,
  delta,
  note,
}: {
  title: string;
  value: string;
  href: string;
  delta?: React.ReactNode;
  note?: string;
}) {
  const style = KPI_STYLE[title];
  return (
    <Link
      href={href}
      className="bg-card hover:bg-muted/50 focus-visible:ring-ring flex min-w-0 flex-col gap-0.5 rounded-xl border px-3 py-2.5 shadow-xs focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-muted-foreground text-xs leading-tight font-medium">{title}</span>
        {style && (
          <span
            aria-hidden
            className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${style.tone}`}
          >
            <style.icon className="size-4" />
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        <span className="truncate text-xl leading-tight font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        {delta}
      </span>
      {note && <span className="text-muted-foreground truncate text-[10px]">{note}</span>}
    </Link>
  );
}

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card size="sm" className={`min-h-0 gap-1 ${className ?? ""}`}>
      <h2 className="px-3 pt-0.5 text-[13px] font-semibold">{title}</h2>
      <div className="min-h-0 flex-1 px-1">{children}</div>
    </Card>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const session = await requireOrgSession();
  const sp = await searchParams;
  const prefs = await getDisplayPrefs();
  const range = resolveRange(sp.range, sp.from, sp.to, new Date(), prefs.timeZone);
  const [d, team, jobs]: [
    Dashboard | null,
    { userId: string; name: string }[],
    Awaited<ReturnType<typeof getJobsDashboard>> | null,
  ] = await Promise.all([
    getDashboard(range).catch(() => null),
    listTeamMembers().catch(() => []),
    session.permissions.has("jobs.view")
      ? getJobsDashboard().catch(() => null)
      : Promise.resolve(null),
  ]);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = session.fullName.split(" ")[0] || "there";
  const today = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full",
    timeZone: prefs.timeZone,
  }).format(new Date());

  if (!d) {
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-xl border p-6 text-sm">
        The dashboard could not be loaded. Please refresh; if it keeps happening, contact your
        administrator.
      </div>
    );
  }
  const k = d.kpi;
  const money = (n: number | undefined) =>
    n === undefined
      ? "—"
      : new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: d.currency,
          maximumFractionDigits: 0,
        }).format(n);
  const count = (n: number | undefined) => (n === undefined ? "—" : String(n));

  const kpis: {
    title: string;
    value: string;
    href: string;
    delta?: React.ReactNode;
    note?: string;
    show: boolean;
  }[] = [
    {
      show: k.enquiries !== undefined,
      title: "Total Enquiries",
      value: count(k.enquiries),
      href: "/leads",
      delta: <Delta now={k.enquiries ?? 0} before={d.previous.enquiries} />,
    },
    {
      show: k.confirmedBookings !== undefined,
      title: "Confirmed Bookings",
      value: count(k.confirmedBookings),
      href: "/bookings",
      delta: <Delta now={k.confirmedBookings ?? 0} before={d.previous.confirmedBookings} />,
    },
    {
      show: k.upcomingDepartures !== undefined,
      title: "Upcoming Departures (30d)",
      value: count(k.upcomingDepartures),
      href: "/bookings",
    },
    {
      show: k.revenue !== undefined,
      title: "Revenue (bookings)",
      value: money(k.revenue),
      href: "/bookings",
      delta: <Delta now={k.revenue ?? 0} before={d.previous.revenue} />,
      note: k.otherCurrencyBookings ? `+${k.otherCurrencyBookings} in other currencies` : undefined,
    },
    {
      show: k.collected !== undefined,
      title: "Collected",
      value: money(k.collected),
      href: "/payments",
      delta: <Delta now={k.collected ?? 0} before={d.previous.collected} />,
    },
    {
      show: k.outstanding !== undefined,
      title: "Outstanding Payments",
      value: money(k.outstanding),
      href: "/payments",
    },
    {
      show: jobs !== null,
      title: "Pending Job Orders",
      value: jobs ? String(jobs.pending + jobs.active) : "—",
      href: "/jobs?status=OPEN",
      note: jobs ? `${jobs.pending} not started · ${jobs.overdue} overdue` : undefined,
    },
    {
      show: k.pendingVisa !== undefined,
      title: "Pending Visa Applications",
      value: count(k.pendingVisa),
      href: "/visa/applications",
    },
    {
      show: k.profit !== undefined,
      title: "Profit (costed bookings)",
      value: k.profitBookings ? money(k.profit) : "—",
      href: "/reports",
      note: k.profitBookings
        ? `${k.profitBookings} of ${k.bookingsInRange} bookings have full cost data`
        : "No bookings with full cost data",
    },
  ];

  const opsAll: (OpsTab | undefined | null)[] = [
    d.departures && {
      id: "dep",
      label: "Departures",
      empty: "No upcoming departures.",
      items: d.departures.map((x) => ({
        key: x.id,
        href: `/bookings/${x.id}`,
        primary: `${x.title}${x.destination ? ` · ${x.destination}` : ""}`,
        secondary: x.date,
      })),
    },
    d.followups && {
      id: "fu",
      label: "Follow-ups",
      empty: "No follow-ups due today.",
      items: d.followups.map((x) => ({
        key: x.id,
        href: related(x.relatedType, x.relatedId),
        primary: x.title,
        secondary: x.due,
      })),
    },
    d.pendingPayments && {
      id: "pay",
      label: "Payments",
      empty: "No payments due in the next 7 days.",
      items: d.pendingPayments.map((x) => ({
        key: `${x.bookingId}-${x.label}`,
        href: `/bookings/${x.bookingId}`,
        primary: `${x.number} · ${x.label}`,
        secondary: `${formatMoney(Number(x.amount), x.currency)} · ${x.status === "OVERDUE" ? "overdue " : "due "}${x.due}`,
      })),
    },
    d.visaDocs && {
      id: "visa",
      label: "Visa documents",
      empty: "No visa documents are missing.",
      items: d.visaDocs.map((x) => ({
        key: x.applicationId,
        href: `/visa/applications/${x.applicationId}?tab=documents`,
        primary: x.number,
        secondary: `${x.missing} missing`,
      })),
    },
    jobs && {
      id: "jobs",
      label: "Overdue jobs",
      empty: "No overdue job orders.",
      items: jobs.overdueList.map((x) => ({
        key: x.id,
        href: `/jobs/${x.id}`,
        primary: `${x.number} · ${x.title}`,
        secondary: `due ${x.deadline}`,
      })),
    },
    d.overdueTasks && {
      id: "od",
      label: "Overdue",
      empty: "Nothing is overdue.",
      items: d.overdueTasks.map((x) => ({
        key: x.id,
        href: related(x.relatedType, x.relatedId),
        primary: x.title,
        secondary: `due ${x.due}`,
      })),
    },
    d.recent && {
      id: "act",
      label: "Activity",
      empty: "No recent activity.",
      items: d.recent.map((x) => ({
        key: x.id,
        href: "/settings/audit",
        primary: `${label(x.action)} · ${label(x.entity)}`,
        secondary: `${x.userId ? (names.get(x.userId) ?? "Staff") : "System"} · ${x.at.slice(5, 16).replace("T", " ")}`,
      })),
    },
  ];
  const ops = opsAll.filter((t): t is OpsTab => Boolean(t));

  const f = d.funnel;
  const presets = Object.entries(RANGE_LABELS) as [keyof typeof RANGE_LABELS, string][];
  const panel = "h-52 [@media(min-width:1024px)_and_(min-height:760px)]:h-auto";

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-2.5 [@media(min-width:1024px)_and_(min-height:760px)]:h-full">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg leading-tight font-semibold tracking-tight">
            {greeting}, {firstName}
          </h1>
          <p className="text-muted-foreground text-xs">
            {today} · showing {range.from} to {range.to} in {d.currency}
          </p>
        </div>
        <form
          className="flex flex-wrap items-center gap-1.5 text-xs"
          role="search"
          aria-label="Date range"
        >
          <nav aria-label="Range presets" className="flex gap-1">
            {presets.map(([key, text]) => (
              <Link
                key={key}
                href={`/dashboard?range=${key}`}
                aria-current={range.key === key ? "true" : undefined}
                className={`rounded-md border px-2 py-1 ${range.key === key ? "bg-primary text-primary-foreground border-transparent" : "hover:bg-muted"}`}
              >
                {text}
              </Link>
            ))}
          </nav>
          <input type="hidden" name="range" value="custom" />
          <input
            type="date"
            name="from"
            defaultValue={range.from}
            aria-label="From"
            className="border-input bg-background h-7 rounded-md border px-1.5"
          />
          <input
            type="date"
            name="to"
            defaultValue={range.to}
            aria-label="To"
            className="border-input bg-background h-7 rounded-md border px-1.5"
          />
          <button
            type="submit"
            className={`h-7 rounded-md border px-2 ${range.key === "custom" ? "bg-primary text-primary-foreground border-transparent" : "hover:bg-muted"}`}
          >
            Custom
          </button>
        </form>
      </div>

      <section
        aria-label="Key metrics"
        className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5 lg:[&>a:last-child:nth-child(5n+4)]:col-span-2"
      >
        {kpis
          .filter((x) => x.show)
          .map((x) => (
            <Kpi key={x.title} {...x} />
          ))}
      </section>

      <section
        aria-label="Charts"
        className="grid min-h-0 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 [@media(min-width:1024px)_and_(min-height:760px)]:flex-[5] [@media(min-width:1024px)_and_(min-height:760px)]:grid-rows-2"
      >
        {d.revenueByMonth && (
          <Panel title="Monthly revenue" className={panel}>
            <RevenueArea data={d.revenueByMonth} currency={d.currency} />
          </Panel>
        )}
        {f && (
          <Panel title="Enquiry conversion" className={panel}>
            <PipelineBar
              data={[
                { stage: "Enquiries", value: f.enquiries },
                { stage: "Quotes sent", value: f.quotations },
                { stage: "Approved", value: f.approved },
                { stage: "Bookings", value: f.bookings },
              ]}
            />
          </Panel>
        )}
        {d.bookingStatus && (
          <Panel title="Booking status" className={panel}>
            <StatusDonut
              data={Object.entries(d.bookingStatus).map(([name, value]) => ({
                name: label(name),
                value,
              }))}
            />
          </Panel>
        )}
        {d.byDestination && (
          <Panel title="Revenue by destination" className={panel}>
            <HorizontalBars
              data={d.byDestination.map((x) => ({ name: x.destination, value: x.value }))}
              currency={d.currency}
            />
          </Panel>
        )}
        {d.collectionByMonth && (
          <Panel title="Collected vs outstanding" className={panel}>
            <CollectionBars data={d.collectionByMonth} currency={d.currency} />
          </Panel>
        )}
        {d.staff && (
          <Panel title="Staff performance (bookings)" className={panel}>
            <HorizontalBars
              money={false}
              color="var(--chart-5)"
              currency={d.currency}
              data={d.staff.map((x) => ({
                name: x.userId ? (names.get(x.userId) ?? "Former staff") : "Unassigned",
                value: x.bookings,
              }))}
            />
          </Panel>
        )}
      </section>

      {ops.length > 0 ? (
        <Card
          size="sm"
          className="h-64 gap-1 px-3 [@media(min-width:1024px)_and_(min-height:760px)]:h-auto [@media(min-width:1024px)_and_(min-height:760px)]:min-h-36 [@media(min-width:1024px)_and_(min-height:760px)]:flex-[2]"
        >
          <OpsTabs tabs={ops} />
        </Card>
      ) : (
        k.enquiries === undefined &&
        k.revenue === undefined && (
          <p className="text-muted-foreground text-sm">
            Your role has no dashboard data to show yet.
          </p>
        )
      )}
    </div>
  );
}
