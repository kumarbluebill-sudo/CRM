import type { Metadata } from "next";
import Link from "next/link";
import { MapPinned, Plus } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { StatusBadge } from "@/components/crm/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { requireOrgSession } from "@/lib/auth/session";
import { listItineraries } from "@/lib/itinerary/queries";

export const metadata: Metadata = { title: "Itineraries" };

export default async function ItinerariesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; view?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("itineraries.view")) {
    return (
      <EmptyState
        icon={MapPinned}
        title="No access"
        description="You don't have permission to view itineraries."
      />
    );
  }
  const sp = await searchParams;
  const templates = sp.view === "templates";
  const { rows, total, page } = await listItineraries({
    templates,
    q: sp.q,
    page: Number.parseInt(sp.page ?? "1", 10) || 1,
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Itineraries"
        description="Build day-by-day travel plans and reuse them as templates."
        actions={
          <>
            <Button
              size="sm"
              variant={templates ? "outline" : "secondary"}
              nativeButton={false}
              render={<Link href="/itineraries" />}
            >
              Itineraries
            </Button>
            <Button
              size="sm"
              variant={templates ? "secondary" : "outline"}
              nativeButton={false}
              render={<Link href="/itineraries?view=templates" />}
            >
              Templates
            </Button>
            {session.permissions.has("itineraries.create") && (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href="/itineraries/import" />}
              >
                Import
              </Button>
            )}
            {session.permissions.has("itineraries.create") && (
              <Button size="sm" nativeButton={false} render={<Link href="/itineraries/new" />}>
                <Plus className="size-4" aria-hidden /> New itinerary
              </Button>
            )}
          </>
        }
      />
      <form className="flex gap-2" role="search">
        {templates && <input type="hidden" name="view" value="templates" />}
        <Input
          name="q"
          defaultValue={sp.q}
          placeholder="Search title or destination…"
          className="max-w-xs"
          aria-label="Search itineraries"
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>
      {rows.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={MapPinned}
              title={sp.q ? "No matches" : templates ? "No templates yet" : "No itineraries yet"}
              description={
                templates ? "Open an itinerary and choose “Save as template”." : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <li key={r.id}>
                <Card size="sm">
                  <CardContent className="flex flex-col gap-2">
                    <Link href={`/itineraries/${r.id}`} className="font-medium hover:underline">
                      {r.title}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {r.destination ?? "—"}
                      {r.customers?.name ? ` · ${r.customers.name}` : ""}
                    </p>
                    <div className="flex items-center justify-between">
                      <StatusBadge value={r.is_template ? "TEMPLATE" : r.status} />
                      <span className="text-muted-foreground text-xs">
                        Updated {new Date(r.updated_at).toLocaleDateString("en-IN")}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            total={total}
            basePath="/itineraries"
            params={{ q: sp.q, view: templates ? "templates" : undefined }}
          />
        </>
      )}
    </div>
  );
}
