import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Tags } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { formatMoney } from "@/lib/quotation/pricing";
import { listProducts } from "@/lib/visa/queries";

export const metadata: Metadata = { title: "Visa products" };

export default async function ProductsPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("visa.view")) {
    return (
      <EmptyState
        icon={Tags}
        title="No access"
        description="You don't have permission to view visa products."
      />
    );
  }
  const rows = await listProducts();
  const canEdit = session.permissions.has("visa.price.edit");
  const canSeePrice = session.permissions.has("visa.price.view");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Visa products"
        description="What the agency sells: country, visa type, entry, processing time and price. Fees and requirements are yours to maintain."
        actions={
          canEdit && (
            <Button size="sm" nativeButton={false} render={<Link href="/visa/products/new" />}>
              <Plus className="size-4" aria-hidden /> New product
            </Button>
          )
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No visa products yet"
          description={
            canEdit
              ? "Add a country under Visa settings, then create the first product."
              : "Ask an administrator to add visa products."
          }
        />
      ) : (
        <Card>
          <CardContent>
            <ul className="divide-y text-sm">
              {rows.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <Link
                    href={`/visa/products/${p.id}`}
                    className="min-w-44 font-medium hover:underline"
                  >
                    {p.visa_countries?.name} · {label(p.visa_type)}
                  </Link>
                  <span className="text-muted-foreground">
                    {label(p.entry_type)} entry
                    {p.nationality ? ` · ${p.nationality}` : " · any nationality"}
                    {p.stay_days ? ` · ${p.stay_days}-day stay` : ""}
                    {p.processing_days_normal != null
                      ? ` · ${p.processing_days_normal} working days`
                      : ""}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    {canSeePrice && p.unit_price != null && (
                      <span className="font-medium">{formatMoney(p.unit_price, p.currency)}</span>
                    )}
                    {!p.active && <StatusBadge value="CANCELLED" />}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
