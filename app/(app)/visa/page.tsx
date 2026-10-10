import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Stamp } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { APPLICATION_STATUSES, isTravelUrgent } from "@/lib/visa/constants";
import {
  getVisaAlerts,
  getVisaDashboard,
  getWorkQueue,
  listApplications,
  listEnquiries,
} from "@/lib/visa/queries";

export const metadata: Metadata = { title: "Visa dashboard" };

function Stat({
  title,
  value,
  href,
  tone,
}: {
  title: string;
  value: number;
  href?: string;
  tone?: "warn";
}) {
  const body = (
    <Card size="sm" className={href ? "hover:bg-muted/50 h-full" : "h-full"}>
      <CardContent>
        <p className="text-muted-foreground text-xs">{title}</p>
        <p
          className={`text-2xl font-semibold ${tone === "warn" && value > 0 ? "text-tone-bad" : ""}`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function VisaDashboardPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("visa.view")) {
    return (
      <EmptyState
        icon={Stamp}
        title="No access"
        description="You don't have permission to view visa work."
      />
    );
  }
  const [d, alerts, q, recent, due] = await Promise.all([
    getVisaDashboard(),
    getVisaAlerts(),
    getWorkQueue(false),
    listApplications({ canSeePassports: false, page: 1 }),
    listEnquiries({ status: "FOLLOW_UP", page: 1 }),
  ]);
  const by = d.byStatus;
  const active = APPLICATION_STATUSES.filter((s) => (by[s] ?? 0) > 0);
  const urgentRows = recent.rows.filter(
    (a) => a.priority === "URGENT" || isTravelUrgent(a.travel_date, a.status),
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Visa dashboard"
        description="What needs attention today."
        actions={
          session.permissions.has("visa.create") && (
            <>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href="/visa/enquiries/new" />}
              >
                New enquiry
              </Button>
              <Button
                size="sm"
                nativeButton={false}
                render={<Link href="/visa/applications/new" />}
              >
                New application
              </Button>
            </>
          )
        }
      />

      <section aria-label="My work" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat title="My open applications" value={d.mine} href="/visa/applications" />
        <Stat
          title="Documents to review"
          value={d.documentsToReview}
          href="/visa/applications?status=DOCUMENT_REVIEW"
        />
        <Stat
          title="Corrections pending"
          value={d.corrections}
          href="/visa/applications?status=CORRECTION_REQUIRED"
          tone="warn"
        />
        <Stat
          title="Urgent or travel date close"
          value={d.urgent}
          href="/visa/applications?priority=URGENT"
          tone="warn"
        />
        <Stat title="Documents still pending" value={d.documentsPending} />
        <Stat title="Open enquiries" value={d.enquiriesOpen} href="/visa/enquiries" />
        <Stat
          title="Enquiry follow-ups due"
          value={d.followUpsDue}
          href="/visa/enquiries?status=FOLLOW_UP"
          tone="warn"
        />
        <Stat
          title="Ready to submit"
          value={by.READY_FOR_SUBMISSION ?? 0}
          href="/visa/applications?status=READY_FOR_SUBMISSION"
        />
        <Stat
          title="Overdue at supplier / embassy"
          value={q.counts.overdue}
          href="/visa/queue?scope=all"
          tone="warn"
        />
        <Stat title="Visas to deliver" value={q.counts.toDeliver} href="/visa/queue?scope=all" />
        <Stat
          title="Visa follow-ups due"
          value={q.counts.followUps}
          href="/visa/queue?scope=all"
          tone="warn"
        />
        <Stat title="Waiting to be priced" value={q.counts.unpriced} href="/visa/queue?scope=all" />
      </section>

      {alerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="text-tone-bad size-4" aria-hidden /> Alerts
              <span className="bg-muted rounded-full px-2 py-0.5 text-xs">{alerts.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" aria-label="Visa alerts">
              {alerts.slice(0, 12).map((al, i) => (
                <li
                  key={`${al.applicationId}-${al.kind}-${i}`}
                  className="flex flex-wrap items-center gap-3 py-2"
                >
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${al.severity === "URGENT" ? "bg-tone-bad-soft text-tone-bad" : "bg-tone-warn-soft text-tone-warn"}`}
                  >
                    {al.severity === "URGENT" ? "Urgent" : "Warning"}
                  </span>
                  <Link
                    href={`/visa/applications/${al.applicationId}`}
                    className="font-medium hover:underline"
                  >
                    {al.number}
                  </Link>
                  <span className="text-muted-foreground">{al.message}</span>
                </li>
              ))}
            </ul>
            {alerts.length > 12 && (
              <p className="text-muted-foreground pt-2 text-xs">
                Showing the first 12 of {alerts.length}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Applications by status</CardTitle>
        </CardHeader>
        <CardContent>
          {active.length === 0 ? (
            <p className="text-muted-foreground text-sm">No applications yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2 text-sm">
              {active.map((s) => (
                <li key={s}>
                  <Link
                    href={`/visa/applications?status=${s}`}
                    className="hover:bg-muted flex items-center gap-2 rounded-lg border px-3 py-1.5"
                  >
                    <StatusBadge value={s} />
                    <span className="font-semibold">{by[s]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {urgentRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="text-tone-bad size-4" aria-hidden /> Needs attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {urgentRows.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                  <Link href={`/visa/applications/${a.id}`} className="font-medium hover:underline">
                    {a.application_number}
                  </Link>
                  <span>{a.customers?.name}</span>
                  <span className="text-muted-foreground">
                    {a.visa_countries?.name} · {label(a.visa_type)}
                  </span>
                  {a.travel_date && (
                    <span className="text-muted-foreground">Travels {a.travel_date}</span>
                  )}
                  <span className="ml-auto flex gap-2">
                    {isTravelUrgent(a.travel_date, a.status) && (
                      <span className="text-tone-bad text-xs">Travel date approaching</span>
                    )}
                    <StatusBadge value={a.status} />
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest applications</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing here yet. Start with an enquiry.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {recent.rows.slice(0, 8).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                    <Link
                      href={`/visa/applications/${a.id}`}
                      className="font-medium hover:underline"
                    >
                      {a.application_number}
                    </Link>
                    <span className="text-muted-foreground truncate">{a.customers?.name}</span>
                    <span className="ml-auto">
                      <StatusBadge value={a.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Enquiries to follow up</CardTitle>
          </CardHeader>
          <CardContent>
            {due.rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">No enquiries marked for follow-up.</p>
            ) : (
              <ul className="divide-y text-sm">
                {due.rows.slice(0, 8).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
                    <Link href={`/visa/enquiries/${e.id}`} className="font-medium hover:underline">
                      {e.enquiry_number}
                    </Link>
                    <span className="text-muted-foreground truncate">{e.customers?.name}</span>
                    <span className="text-muted-foreground ml-auto">
                      {e.follow_up_date ?? "No date"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
