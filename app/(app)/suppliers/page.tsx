import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Truck } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { SUPPLIER_TYPES } from "@/lib/booking/schema";
import { listSuppliers } from "@/lib/booking/queries";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; page?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("suppliers.view")) {
    return (
      <EmptyState
        icon={Truck}
        title="No access"
        description="You don't have permission to view suppliers."
      />
    );
  }
  const sp = await searchParams;
  const type = SUPPLIER_TYPES.find((t) => t === sp.type);
  const { rows, total, page } = await listSuppliers({
    q: sp.q,
    type,
    page: Number.parseInt(sp.page ?? "1", 10) || 1,
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Suppliers"
        description="Hotels, transport, activity operators and other partners."
        actions={
          session.permissions.has("suppliers.manage") && (
            <Button size="sm" nativeButton={false} render={<Link href="/suppliers/new" />}>
              <Plus className="size-4" aria-hidden /> New supplier
            </Button>
          )
        }
      />
      <form className="flex flex-wrap gap-2" role="search">
        <Input
          name="q"
          defaultValue={sp.q}
          placeholder="Search name, destination or contact…"
          className="max-w-xs"
          aria-label="Search suppliers"
        />
        <select
          name="type"
          defaultValue={type ?? ""}
          aria-label="Filter by type"
          className="border-input bg-background h-8 rounded-lg border px-2.5 text-sm"
        >
          <option value="">All types</option>
          {SUPPLIER_TYPES.map((t) => (
            <option key={t} value={t}>
              {label(t)}
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
              icon={Truck}
              title={sp.q || type ? "No suppliers match" : "No suppliers yet"}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((s) => (
              <li key={s.id}>
                <Card size="sm">
                  <CardContent className="flex flex-col gap-1">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/suppliers/${s.id}`} className="font-medium hover:underline">
                        {s.company_name}
                      </Link>
                      <Badge variant="secondary">{label(s.type)}</Badge>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {s.destination ?? "—"}
                      {s.is_active ? "" : " · inactive"}
                    </p>
                    <div className="flex flex-wrap gap-3 pt-1 text-sm">
                      {s.phone && (
                        <a className="text-primary underline" href={`tel:${s.phone}`}>
                          {s.phone}
                        </a>
                      )}
                      {s.email && (
                        <a className="text-primary underline" href={`mailto:${s.email}`}>
                          {s.email}
                        </a>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination page={page} total={total} basePath="/suppliers" params={{ q: sp.q, type }} />
        </>
      )}
    </div>
  );
}
