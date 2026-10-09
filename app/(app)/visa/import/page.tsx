import type { Metadata } from "next";
import { Upload } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { ImportForm } from "@/components/visa/import-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { IMPORT_COLUMNS } from "@/lib/visa/csv-parse";

export const metadata: Metadata = { title: "Import visa data" };

export default async function VisaImportPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("visa.price.edit")) {
    return (
      <EmptyState
        icon={Upload}
        title="No access"
        description="You need permission to edit visa prices to import master data."
      />
    );
  }
  const canCost = session.permissions.has("visa.supplier.edit");
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Import visa data"
        description="Check a CSV first, then confirm. Rows that already exist are skipped; nothing is ever overwritten."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Countries</CardTitle>
        </CardHeader>
        <CardContent>
          <ImportForm kind="countries" columns={[...IMPORT_COLUMNS.countries]} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Visa products and prices</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            Import countries first; each product row refers to one by its 2-letter code. Put where
            the figures came from in <code>source</code>.
            {!canCost &&
              " Government and supplier fee columns need supplier-cost permission and will be refused."}
          </p>
          <ImportForm kind="products" columns={[...IMPORT_COLUMNS.products]} />
        </CardContent>
      </Card>
    </div>
  );
}
