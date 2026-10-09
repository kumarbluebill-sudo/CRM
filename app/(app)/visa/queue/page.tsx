import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { getWorkQueue } from "@/lib/visa/queries";

export const metadata: Metadata = { title: "Visa work queue" };

type Row = { key: string; href: string; primary: string; secondary?: string };

function Section({
  title,
  hint,
  count,
  rows,
  tone,
}: {
  title: string;
  hint: string;
  count: number;
  rows: Row[];
  tone?: "warn";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {title}
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${tone === "warn" && count > 0 ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-muted"}`}
          >
            {count}
          </span>
        </CardTitle>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing here.</p>
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-3 py-2">
                <Link href={r.href} className="font-medium hover:underline">
                  {r.primary}
                </Link>
                {r.secondary && <span className="text-muted-foreground">{r.secondary}</span>}
              </li>
            ))}
          </ul>
        )}
        {count > rows.length && (
          <p className="text-muted-foreground pt-2 text-xs">Showing the first {rows.length}.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function VisaQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("visa.view")) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No access"
        description="You don't have permission to view visa work."
      />
    );
  }
  const everyone = (await searchParams).scope === "all";
  const q = await getWorkQueue(!everyone);
  const app = (id: string, tab?: string) => `/visa/applications/${id}${tab ? `?tab=${tab}` : ""}`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title="Visa work queue"
        description={
          everyone
            ? "Everything that needs doing across the agency."
            : "What needs doing on your applications, plus anything unassigned."
        }
        actions={
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={everyone ? "/visa/queue" : "/visa/queue?scope=all"} />}
          >
            {everyone ? "Show mine" : "Show everyone's"}
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Documents to review"
          hint="Uploaded and waiting for a decision."
          count={q.counts.review}
          rows={q.review.map((r) => ({
            key: r.id,
            href: app(r.applicationId, "documents"),
            primary: r.number,
            secondary: r.name,
          }))}
        />
        <Section
          title="Corrections pending"
          hint="Waiting for the customer to fix or re-send."
          count={q.counts.corrections}
          tone="warn"
          rows={q.corrections.map((r) => ({
            key: r.applicationId,
            href: app(r.applicationId, "documents"),
            primary: r.number,
            secondary: r.note ?? undefined,
          }))}
        />
        <Section
          title="Ready to submit"
          hint="All required documents approved."
          count={q.counts.toSubmit}
          rows={q.toSubmit.map((r) => ({
            key: r.applicationId,
            href: app(r.applicationId, "processing"),
            primary: r.number,
            secondary: r.travelDate ? `Travels ${r.travelDate}` : undefined,
          }))}
        />
        <Section
          title="Overdue at supplier / embassy"
          hint="Past the expected completion date."
          count={q.counts.overdue}
          tone="warn"
          rows={q.overdue.map((r) => ({
            key: r.applicationId,
            href: app(r.applicationId, "supplier"),
            primary: r.number,
            secondary: `Expected ${r.expected}`,
          }))}
        />
        <Section
          title="Approved: record the final visa"
          hint="Upload the visa and its details."
          count={q.counts.toRecord}
          rows={q.toRecord.map((r) => ({
            key: r.applicationId,
            href: app(r.applicationId, "delivery"),
            primary: r.number,
          }))}
        />
        <Section
          title="Ready to deliver"
          hint="Visa received; send it to the customer."
          count={q.counts.toDeliver}
          rows={q.toDeliver.map((r) => ({
            key: r.applicationId,
            href: app(r.applicationId, "delivery"),
            primary: r.number,
            secondary: r.travelDate ? `Travels ${r.travelDate}` : undefined,
          }))}
        />
        <Section
          title="Follow-ups due"
          hint="Tasks linked to visa applications, due today or earlier."
          count={q.counts.followUps}
          tone="warn"
          rows={q.followUps.map((r) => ({
            key: r.id,
            href: app(r.applicationId, "tasks"),
            primary: r.title,
            secondary: `Due ${r.due}`,
          }))}
        />
        <Card size="sm">
          <CardContent>
            <p className="text-muted-foreground text-xs">Early applications not yet priced</p>
            <p className="text-2xl font-semibold">{q.counts.unpriced}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
