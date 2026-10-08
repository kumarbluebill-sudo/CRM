import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { RemoveRequirementButton } from "@/components/visa/master-controls";
import { StatusBadge } from "@/components/crm/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import { label, options } from "@/lib/crm/constants";
import { listTeamMembers } from "@/lib/crm/queries";
import { uuid } from "@/lib/crm/schemas";
import { formatMoney } from "@/lib/quotation/pricing";
import { ENTRY_TYPES, VISA_TYPES } from "@/lib/visa/constants";
import {
  getProduct,
  getProductCost,
  listDocumentTypes,
  listPriceHistory,
  listRequirements,
  listVisaSuppliers,
} from "@/lib/visa/queries";
import {
  addRequirementAction,
  updatePricingAction,
  updateProductAction,
} from "@/app/(app)/visa/actions";

export const metadata: Metadata = { title: "Visa product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  const found = await getProduct(id);
  if (!found) notFound();
  const { product: p, unitPrice, expressPrice } = found;
  const perms = session.permissions;
  const canEdit = perms.has("visa.price.edit");
  const canCost = perms.has("visa.supplier.view");
  const [cost, requirements, docTypes, suppliers, history, team] = await Promise.all([
    canCost ? getProductCost(id) : Promise.resolve(null),
    listRequirements(id),
    listDocumentTypes(),
    listVisaSuppliers(),
    perms.has("visa.price.view") ? listPriceHistory(id) : Promise.resolve([]),
    listTeamMembers(),
  ]);
  const names = new Map(team.map((m) => [m.userId, m.name]));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={`${p.visa_countries?.name ?? ""} · ${label(p.visa_type)}`}
        description={`${label(p.entry_type)} entry${p.nationality ? ` · ${p.nationality}` : " · any nationality"}`}
        actions={!p.active && <StatusBadge value="CANCELLED" />}
      />

      {perms.has("visa.price.view") && (
        <Card>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground text-xs">Selling price (per traveller)</p>
              <p className="text-xl font-semibold">
                {unitPrice != null ? formatMoney(unitPrice, p.currency) : "–"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Express</p>
              <p className="text-xl font-semibold">
                {expressPrice != null ? formatMoney(expressPrice, p.currency) : "–"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Data source</p>
              <p>{p.source || "Not recorded"}</p>
              <p className="text-muted-foreground text-xs">Updated {p.updated_at.slice(0, 10)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <EntityForm
              action={updateProductAction.bind(null, id)}
              submitLabel="Save details"
              fields={[
                {
                  name: "visaType",
                  label: "Visa type",
                  type: "select",
                  required: true,
                  options: options(VISA_TYPES),
                  defaultValue: p.visa_type,
                },
                {
                  name: "entryType",
                  label: "Entry",
                  type: "select",
                  required: true,
                  options: options(ENTRY_TYPES),
                  defaultValue: p.entry_type,
                },
                {
                  name: "nationality",
                  label: "Nationality (blank = any)",
                  defaultValue: p.nationality,
                },
                {
                  name: "stayDays",
                  label: "Stay (days)",
                  type: "number",
                  min: 1,
                  defaultValue: p.stay_days,
                },
                {
                  name: "validityDays",
                  label: "Visa validity (days)",
                  type: "number",
                  min: 1,
                  defaultValue: p.validity_days,
                },
                {
                  name: "passportValidityMonths",
                  label: "Passport validity needed (months)",
                  type: "number",
                  min: 0,
                  defaultValue: p.passport_validity_months,
                },
                {
                  name: "processingDaysNormal",
                  label: "Normal processing (working days)",
                  type: "number",
                  min: 0,
                  defaultValue: p.processing_days_normal,
                },
                {
                  name: "processingDaysExpress",
                  label: "Express processing (working days)",
                  type: "number",
                  min: 0,
                  defaultValue: p.processing_days_express,
                },
                {
                  name: "supplierId",
                  label: "Supplier",
                  type: "select",
                  options: suppliers,
                  defaultValue: p.supplier_id,
                },
                {
                  name: "source",
                  label: "Where this information comes from",
                  wide: true,
                  defaultValue: p.source,
                },
                {
                  name: "active",
                  label: "Available to sell",
                  type: "checkbox",
                  defaultValue: p.active,
                },
              ]}
            />
          </CardContent>
        </Card>
      )}

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pricing</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              Selling price = (government fee + supplier fee + service fee) × (1 + markup %) × (1 +
              GST %). Every change needs a reason and is kept in the price history.
              {!canCost &&
                " Government and supplier fees can only be changed by staff with supplier access."}
            </p>
            <EntityForm
              action={updatePricingAction.bind(null, id)}
              submitLabel="Update pricing"
              fields={[
                ...(canCost && perms.has("visa.supplier.edit")
                  ? [
                      {
                        name: "governmentFee",
                        label: "Government / embassy fee",
                        type: "number" as const,
                        min: 0,
                        step: "0.01",
                        defaultValue: cost?.government_fee ?? 0,
                      },
                      {
                        name: "supplierFee",
                        label: "Supplier fee",
                        type: "number" as const,
                        min: 0,
                        step: "0.01",
                        defaultValue: cost?.supplier_fee ?? 0,
                      },
                    ]
                  : []),
                {
                  name: "serviceFee",
                  label: "Agency service fee",
                  type: "number",
                  min: 0,
                  step: "0.01",
                  defaultValue: p.service_fee,
                },
                {
                  name: "expressFee",
                  label: "Express surcharge",
                  type: "number",
                  min: 0,
                  step: "0.01",
                  defaultValue: p.express_fee,
                },
                {
                  name: "markupPercent",
                  label: "Markup %",
                  type: "number",
                  min: 0,
                  step: "0.01",
                  defaultValue: p.markup_percent,
                },
                {
                  name: "gstPercent",
                  label: "GST %",
                  type: "number",
                  min: 0,
                  step: "0.01",
                  defaultValue: p.gst_percent,
                },
                {
                  name: "reason",
                  label: "Reason for this change",
                  required: true,
                  wide: true,
                  placeholder: "e.g. Supplier updated fee",
                },
              ]}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Document requirements</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            New applications for this product get this checklist for each traveller. Changing it
            doesn&apos;t alter applications already created.
          </p>
          {requirements.length === 0 ? (
            <p className="text-sm">No requirements configured yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {requirements.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium">{r.visa_document_types?.name}</span>
                  <span className="text-muted-foreground">
                    {r.required ? "Required" : "Optional"} · {label(r.applicant_type)}
                    {r.nationality ? ` · ${r.nationality} only` : ""}
                  </span>
                  {canEdit && (
                    <span className="ml-auto">
                      <RemoveRequirementButton productId={id} id={r.id} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit &&
            (docTypes.filter((d) => d.active).length === 0 ? (
              <p className="text-sm">Add document types under Visa settings first.</p>
            ) : (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">Add a requirement</summary>
                <div className="pt-3">
                  <EntityForm
                    action={addRequirementAction.bind(null, id)}
                    submitLabel="Add requirement"
                    fields={[
                      {
                        name: "documentTypeId",
                        label: "Document",
                        type: "select",
                        required: true,
                        options: docTypes
                          .filter((d) => d.active)
                          .map((d) => ({ value: d.id, label: d.name })),
                      },
                      {
                        name: "applicantType",
                        label: "Applies to",
                        type: "select",
                        required: true,
                        defaultValue: "ALL",
                        options: [
                          { value: "ALL", label: "Everyone" },
                          { value: "ADULT", label: "Adults" },
                          { value: "CHILD", label: "Children" },
                          { value: "INFANT", label: "Infants" },
                        ],
                      },
                      { name: "nationality", label: "Only for nationality (blank = all)" },
                      { name: "required", label: "Required", type: "checkbox", defaultValue: true },
                    ]}
                  />
                </div>
              </details>
            ))}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Price history</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span>
                    {h.old_price != null ? formatMoney(Number(h.old_price), p.currency) : "–"} →{" "}
                    <strong>{formatMoney(Number(h.new_price), p.currency)}</strong>
                  </span>
                  <span className="text-muted-foreground">{h.reason}</span>
                  <span className="text-muted-foreground ml-auto text-xs">
                    {h.created_at.slice(0, 10)} ·{" "}
                    {h.changed_by ? (names.get(h.changed_by) ?? "Staff") : ""}
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
