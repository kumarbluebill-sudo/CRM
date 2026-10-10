import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, Plus } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { StatusBadge } from "@/components/crm/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { listTeamMembers } from "@/lib/crm/queries";
import { uuid } from "@/lib/crm/schemas";
import { APPLICATION_STATUSES, PRIORITIES, isTravelUrgent } from "@/lib/visa/constants";
import { listApplications, listCountries } from "@/lib/visa/queries";

export const metadata: Metadata = { title: "Visa applications" };

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    priority?: string;
    country?: string;
    staff?: string;
    page?: string;
  }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("visa.view")) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="No access"
        description="You don't have permission to view visa applications."
      />
    );
  }
  const sp = await searchParams;
  const status = APPLICATION_STATUSES.find((s) => s === sp.status);
  const priority = PRIORITIES.find((p) => p === sp.priority);
  const country = sp.country && uuid.safeParse(sp.country).success ? sp.country : undefined;
  const staff = sp.staff && uuid.safeParse(sp.staff).success ? sp.staff : undefined;
  const [{ rows, total, page }, team, countries] = await Promise.all([
    listApplications({
      q: sp.q,
      status,
      priority,
      countryId: country,
      staff,
      page: Number.parseInt(sp.page ?? "1", 10) || 1,
      canSeePassports: session.permissions.has("visa.document.view"),
    }),
    listTeamMembers(),
    listCountries(),
  ]);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const select =
    "border-input bg-background focus-visible:ring-ring/50 h-8 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Visa applications"
        description="Every application from first documents to delivery."
        actions={
          session.permissions.has("visa.create") && (
            <Button size="sm" nativeButton={false} render={<Link href="/visa/applications/new" />}>
              <Plus className="size-4" aria-hidden /> New application
            </Button>
          )
        }
      />
      <form className="flex flex-wrap gap-2" role="search">
        <Input
          name="q"
          defaultValue={sp.q}
          placeholder="Number, customer or passport…"
          className="max-w-xs"
          aria-label="Search applications"
        />
        <select name="status" defaultValue={status ?? ""} className={select} aria-label="Status">
          <option value="">All statuses</option>
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <select
          name="priority"
          defaultValue={priority ?? ""}
          className={select}
          aria-label="Priority"
        >
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {label(p)}
            </option>
          ))}
        </select>
        <select name="country" defaultValue={country ?? ""} className={select} aria-label="Country">
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          name="staff"
          defaultValue={staff ?? ""}
          className={select}
          aria-label="Staff member"
        >
          <option value="">Any staff</option>
          {team.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No visa applications found"
          description="Try a different filter, or start a new application."
        />
      ) : (
        <Card>
          <CardContent>
            <ul className="divide-y text-sm">
              {rows.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <Link
                    href={`/visa/applications/${a.id}`}
                    className="min-w-32 font-medium hover:underline"
                  >
                    {a.application_number}
                  </Link>
                  <span>{a.customers?.name}</span>
                  <span className="text-muted-foreground">
                    {a.visa_countries?.name} · {label(a.visa_type)}
                    {a.travel_date ? ` · travels ${a.travel_date}` : ""}
                  </span>
                  <span className="text-muted-foreground">
                    {a.processor_user_id ? (names.get(a.processor_user_id) ?? "") : "No processor"}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {isTravelUrgent(a.travel_date, a.status) && (
                      <span className="text-tone-bad text-xs font-medium">Travel soon</span>
                    )}
                    {a.priority !== "NORMAL" && <StatusBadge value={a.priority} />}
                    <StatusBadge value={a.status} />
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Pagination
        page={page}
        total={total}
        basePath="/visa/applications"
        params={{ q: sp.q, status, priority, country, staff }}
      />
    </div>
  );
}
