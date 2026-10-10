import type { Metadata } from "next";
import { FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { SignatureUploader, VerifyTaxCodeButton } from "@/components/invoicing/tax-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { GST_STATES } from "@/lib/gst/states";
import { getTaxProfile, listTaxCodes } from "@/lib/invoicing/queries";
import { saveTaxCodeAction, saveTaxProfileAction } from "@/app/(app)/settings/invoicing/actions";

export const metadata: Metadata = { title: "Invoicing and GST" };

const TREATMENTS = [
  { value: "TAXABLE", label: "Taxable (has a rate)" },
  { value: "EXEMPT", label: "Exempt" },
  { value: "ZERO_RATED", label: "Zero-rated" },
  { value: "NIL_RATED", label: "Nil-rated" },
];

export default async function InvoicingSettingsPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("invoicing.manage")) {
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title="No access"
        description="Only owners, administrators and accountants can change invoicing and GST settings."
      />
    );
  }
  const [p, codes] = await Promise.all([getTaxProfile(), listTaxCodes()]);
  const states = GST_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Invoicing and GST"
        description="Your registered details, numbering and tax codes. Have your accountant review these before issuing real invoices."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Business and numbering</CardTitle>
        </CardHeader>
        <CardContent>
          <EntityForm
            action={saveTaxProfileAction}
            submitLabel="Save profile"
            fields={[
              {
                name: "legalName",
                label: "Legal business name",
                required: true,
                defaultValue: p?.legal_name,
                wide: true,
              },
              {
                name: "tradeName",
                label: "Trade name (if different)",
                defaultValue: p?.trade_name,
              },
              {
                name: "address",
                label: "Registered address",
                type: "textarea",
                required: true,
                defaultValue: p?.address,
                wide: true,
              },
              {
                name: "stateCode",
                label: "State of registration",
                type: "select",
                required: true,
                options: states,
                defaultValue: p?.state_code,
              },
              {
                name: "gstRegistered",
                label: "We are registered under GST",
                type: "checkbox",
                defaultValue: p?.gst_registered,
              },
              {
                name: "gstin",
                label: "GSTIN (required if registered)",
                defaultValue: p?.gstin,
                placeholder: "27AAPFU0939F1ZV",
              },
              { name: "pan", label: "PAN", defaultValue: p?.pan, placeholder: "ABCDE1234F" },
              {
                name: "invoicePrefix",
                label: "Invoice number prefix (1-5 letters or digits)",
                defaultValue: p?.invoice_prefix ?? "INV",
              },
              {
                name: "pricesIncludeTax",
                label: "Prices normally include tax",
                type: "checkbox",
                defaultValue: p?.prices_include_tax,
              },
              {
                name: "roundOff",
                label: "Round invoice totals to the nearest rupee",
                type: "checkbox",
                defaultValue: p?.round_off ?? true,
              },
              { name: "bankName", label: "Bank", defaultValue: p?.bank_name },
              {
                name: "bankAccountName",
                label: "Account holder",
                defaultValue: p?.bank_account_name,
              },
              { name: "bankAccountNo", label: "Account number", defaultValue: p?.bank_account_no },
              {
                name: "bankIfsc",
                label: "IFSC",
                defaultValue: p?.bank_ifsc,
                placeholder: "HDFC0001234",
              },
              {
                name: "upiId",
                label: "UPI ID",
                defaultValue: p?.upi_id,
                placeholder: "agency@bank",
              },
              {
                name: "terms",
                label: "Default invoice terms",
                type: "textarea",
                defaultValue: p?.terms,
                wide: true,
              },
            ]}
          />
          <p className="text-muted-foreground pt-3 text-xs">
            Numbers look like <code>{p?.invoice_prefix ?? "INV"}/26-27/0001</code> and restart each
            financial year (April to March). If you are not GST-registered, invoices are issued
            without tax.
          </p>
        </CardContent>
      </Card>

      {p && (
        <Card>
          <CardContent>
            <SignatureUploader signature={p.signature_data} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tax codes</CardTitle>
          <p className="text-muted-foreground text-xs">
            Nothing is pre-filled. Enter the SAC code and rate your accountant confirms for each
            service, then mark it verified. An unverified code cannot be used to issue an invoice,
            and changing a rate or SAC clears the verification.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {codes.length === 0 ? (
            <p className="text-muted-foreground text-sm">No tax codes yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {codes.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 py-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-40 font-medium">{c.name}</span>
                    <span className="text-muted-foreground">
                      {c.sac_code ? `SAC ${c.sac_code} · ` : ""}
                      {c.treatment === "TAXABLE"
                        ? `${Number(c.rate)}%`
                        : c.treatment.replace("_", " ").toLowerCase()}
                      {!c.active ? " · inactive" : ""}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      {c.verified_at ? (
                        <span className="text-xs text-tone-ok">
                          Verified {c.verified_at.slice(0, 10)}
                        </span>
                      ) : (
                        <>
                          <span className="text-xs text-tone-warn">
                            Not verified
                          </span>
                          <VerifyTaxCodeButton id={c.id} />
                        </>
                      )}
                    </span>
                  </div>
                  <details className="rounded-lg border p-3">
                    <summary className="cursor-pointer text-xs font-medium">Edit</summary>
                    <div className="pt-3">
                      <EntityForm
                        action={saveTaxCodeAction.bind(null, c.id)}
                        submitLabel="Save"
                        fields={[
                          { name: "name", label: "Name", required: true, defaultValue: c.name },
                          { name: "sacCode", label: "SAC code", defaultValue: c.sac_code },
                          {
                            name: "treatment",
                            label: "Treatment",
                            type: "select",
                            required: true,
                            options: TREATMENTS,
                            defaultValue: c.treatment,
                          },
                          {
                            name: "rate",
                            label: "Rate %",
                            type: "number",
                            min: 0,
                            step: "0.01",
                            defaultValue: Number(c.rate),
                          },
                          {
                            name: "active",
                            label: "Active",
                            type: "checkbox",
                            defaultValue: c.active,
                          },
                        ]}
                      />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Add a tax code</summary>
            <div className="pt-3">
              <EntityForm
                action={saveTaxCodeAction.bind(null, null)}
                submitLabel="Add tax code"
                fields={[
                  {
                    name: "name",
                    label: "Name",
                    required: true,
                    placeholder: "Tour package services",
                  },
                  { name: "sacCode", label: "SAC code", placeholder: "4-8 digits" },
                  {
                    name: "treatment",
                    label: "Treatment",
                    type: "select",
                    required: true,
                    options: TREATMENTS,
                    defaultValue: "TAXABLE",
                  },
                  {
                    name: "rate",
                    label: "Rate %",
                    type: "number",
                    min: 0,
                    step: "0.01",
                    defaultValue: 0,
                  },
                ]}
              />
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
