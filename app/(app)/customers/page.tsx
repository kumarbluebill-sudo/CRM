import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { requireOrgSession } from "@/lib/auth/session";
import { listCustomers } from "@/lib/crm/queries";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("customers.view")) {
    return (
      <EmptyState
        icon={Users}
        title="No access"
        description="You don't have permission to view customers."
      />
    );
  }
  const sp = await searchParams;
  const { rows, total, page } = await listCustomers({
    q: sp.q,
    page: Number.parseInt(sp.page ?? "1", 10) || 1,
  });
  const canCreate = session.permissions.has("customers.create");

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Customers"
        description="Everyone you've quoted, booked or travelled with."
        actions={
          canCreate && (
            <Button size="sm" nativeButton={false} render={<Link href="/customers/new" />}>
              <Plus className="size-4" aria-hidden /> New customer
            </Button>
          )
        }
      />
      <form className="flex gap-2" role="search">
        <Input
          name="q"
          defaultValue={sp.q}
          placeholder="Search name, phone or email…"
          className="max-w-xs"
          aria-label="Search customers"
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>
      {rows.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Users}
              title={sp.q ? "No customers match your search" : "No customers yet"}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((c) => (
              <li key={c.id}>
                <Card size="sm">
                  <CardContent className="flex flex-col gap-1">
                    <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {[c.city, c.country].filter(Boolean).join(", ") || "—"}
                    </p>
                    <div className="flex flex-wrap gap-3 pt-1 text-sm">
                      {c.phone && (
                        <a className="text-primary underline" href={`tel:${c.phone}`}>
                          {c.phone}
                        </a>
                      )}
                      {c.whatsapp && (
                        <a
                          className="text-primary underline"
                          href={`https://wa.me/${c.whatsapp.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          WhatsApp
                        </a>
                      )}
                      {c.email && (
                        <a className="text-primary underline" href={`mailto:${c.email}`}>
                          {c.email}
                        </a>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination page={page} total={total} basePath="/customers" params={{ q: sp.q }} />
        </>
      )}
    </div>
  );
}
