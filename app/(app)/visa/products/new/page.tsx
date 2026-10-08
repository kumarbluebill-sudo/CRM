import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { options } from "@/lib/crm/constants";
import { ENTRY_TYPES, VISA_TYPES } from "@/lib/visa/constants";
import { listCountries, listVisaSuppliers } from "@/lib/visa/queries";
import { createProductAction } from "@/app/(app)/visa/actions";

export const metadata: Metadata = { title: "New visa product" };

export default async function NewProductPage() {
  // requireOrgSession redirects when signed out (so the page is never prerendered at build time).
  const session = await requireOrgSession();
  if (!session.permissions.has("visa.price.edit")) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="No access"
        description="You don't have permission to add visa products."
      />
    );
  }
  const [countries, suppliers] = await Promise.all([listCountries(true), listVisaSuppliers()]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="New visa product"
        description="Fees are set on the next screen, with a recorded reason."
      />
      {countries.length === 0 ? (
        <p className="text-sm">
          Add a country first under{" "}
          <Link href="/visa/settings" className="text-primary underline">
            Visa settings
          </Link>
          .
        </p>
      ) : (
        <Card>
          <CardContent>
            <EntityForm
              action={createProductAction}
              submitLabel="Create product"
              fields={[
                {
                  name: "countryId",
                  label: "Country",
                  type: "select",
                  required: true,
                  options: countries.map((c) => ({ value: c.id, label: c.name })),
                },
                {
                  name: "visaType",
                  label: "Visa type",
                  type: "select",
                  required: true,
                  options: options(VISA_TYPES),
                  defaultValue: "TOURIST",
                },
                {
                  name: "entryType",
                  label: "Entry",
                  type: "select",
                  required: true,
                  options: options(ENTRY_TYPES),
                  defaultValue: "SINGLE",
                },
                {
                  name: "nationality",
                  label: "Nationality (blank = any)",
                  placeholder: "e.g. Indian",
                },
                { name: "stayDays", label: "Stay (days)", type: "number", min: 1 },
                { name: "validityDays", label: "Visa validity (days)", type: "number", min: 1 },
                {
                  name: "passportValidityMonths",
                  label: "Passport validity needed (months)",
                  type: "number",
                  min: 0,
                  defaultValue: 6,
                },
                {
                  name: "processingDaysNormal",
                  label: "Normal processing (working days)",
                  type: "number",
                  min: 0,
                },
                {
                  name: "processingDaysExpress",
                  label: "Express processing (working days)",
                  type: "number",
                  min: 0,
                },
                { name: "supplierId", label: "Supplier", type: "select", options: suppliers },
                {
                  name: "source",
                  label: "Where this information comes from",
                  wide: true,
                  placeholder: "e.g. Embassy site, 8 Oct 2026, or supplier price list",
                },
              ]}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
