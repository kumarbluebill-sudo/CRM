import type { Metadata } from "next";
import { SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm } from "@/components/forms/entity-form";
import { CountryToggle } from "@/components/visa/master-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { listCountries, listDocumentTypes } from "@/lib/visa/queries";
import { createCountryAction, createDocumentTypeAction } from "@/app/(app)/visa/actions";

export const metadata: Metadata = { title: "Visa settings" };

export default async function VisaSettingsPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("visa.view")) {
    return (
      <EmptyState
        icon={SlidersHorizontal}
        title="No access"
        description="You don't have permission to view visa settings."
      />
    );
  }
  const canEdit = session.permissions.has("visa.price.edit");
  const [countries, docTypes] = await Promise.all([listCountries(), listDocumentTypes()]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Visa settings"
        description="Countries and document types used by visa products and checklists."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Countries</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {countries.length === 0 ? (
            <p className="text-sm">No countries yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {countries.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">
                    {c.iso_code}
                    {c.region ? ` · ${c.region}` : ""}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {!c.active && <StatusBadge value="CANCELLED" />}
                    {canEdit && <CountryToggle id={c.id} active={c.active} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Add a country</summary>
              <div className="pt-3">
                <EntityForm
                  action={createCountryAction}
                  submitLabel="Add country"
                  fields={[
                    { name: "name", label: "Country", required: true },
                    { name: "isoCode", label: "2-letter code", required: true, placeholder: "TH" },
                    { name: "region", label: "Region", placeholder: "Asia" },
                  ]}
                />
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Document types</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            What staff ask customers for (passport, photograph, bank statement…). Both filing
            categories are access-restricted and never public.
          </p>
          {docTypes.length === 0 ? (
            <p className="text-sm">No document types yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {docTypes.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-muted-foreground">
                    {d.code} · filed as {label(d.storage_category)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Add a document type</summary>
              <div className="pt-3">
                <EntityForm
                  action={createDocumentTypeAction}
                  submitLabel="Add document type"
                  fields={[
                    { name: "name", label: "Name", required: true, placeholder: "Bank statement" },
                    { name: "code", label: "Code", required: true, placeholder: "BANK_STATEMENT" },
                    {
                      name: "storageCategory",
                      label: "File as",
                      type: "select",
                      required: true,
                      defaultValue: "VISA",
                      options: [
                        { value: "VISA", label: "Visa document" },
                        { value: "PASSPORT", label: "Passport / identity" },
                      ],
                    },
                  ]}
                />
              </div>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
