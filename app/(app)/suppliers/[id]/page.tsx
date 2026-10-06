import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supplierFields } from "@/components/booking/supplier-fields";
import { ConfirmActionButton } from "@/components/crm/confirm-action-button";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import { uuid } from "@/lib/crm/schemas";
import { getSupplier, listSupplierDetail } from "@/lib/booking/queries";
import {
  addSupplierContactAction,
  addSupplierServiceAction,
  deleteSupplierAction,
  deleteSupplierContactAction,
  deleteSupplierServiceAction,
  updateSupplierAction,
} from "@/app/(app)/suppliers/actions";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  if (!session.permissions.has("suppliers.view")) notFound();
  const supplier = await getSupplier(id); // null for missing or other-organization ids (RLS)
  if (!supplier) notFound();
  const { contacts, services } = await listSupplierDetail(id);
  const canManage = session.permissions.has("suppliers.manage");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={supplier.company_name}
        description={supplier.destination ?? undefined}
        actions={
          canManage && (
            <ConfirmActionButton
              action={deleteSupplierAction.bind(null, id)}
              triggerLabel="Delete"
              title="Delete this supplier?"
              description="Suppliers used by a booking can't be deleted; mark them inactive instead."
            />
          )
        }
      />
      <div className="bg-card rounded-xl border p-5">
        {canManage ? (
          <EntityForm
            action={updateSupplierAction.bind(null, id)}
            submitLabel="Save supplier"
            fields={supplierFields(supplier, true)}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            You have read-only access to this supplier.
          </p>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contacts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {contacts.length === 0 && (
              <p className="text-muted-foreground text-sm">No contacts yet.</p>
            )}
            {contacts.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-2 text-sm">
                <div>
                  <p className="font-medium">
                    {c.name}
                    {c.role ? (
                      <span className="text-muted-foreground font-normal"> · {c.role}</span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {[c.phone, c.email].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {canManage && (
                  <ConfirmActionButton
                    action={deleteSupplierContactAction.bind(null, c.id, id)}
                    triggerLabel="Remove"
                    title={`Remove ${c.name}?`}
                    description="This contact will be deleted."
                  />
                )}
              </div>
            ))}
            {canManage && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">Add contact</summary>
                <div className="pt-3">
                  <EntityForm
                    action={addSupplierContactAction.bind(null, id)}
                    submitLabel="Add contact"
                    fields={[
                      { name: "name", label: "Name", required: true },
                      { name: "role", label: "Role" },
                      { name: "phone", label: "Phone", type: "tel" },
                      { name: "email", label: "Email", type: "email" },
                    ]}
                  />
                </div>
              </details>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Services & rates</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {services.length === 0 && (
              <p className="text-muted-foreground text-sm">No services yet.</p>
            )}
            {services.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-2 text-sm">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {s.unit_rate !== null
                      ? `${s.currency} ${Number(s.unit_rate).toLocaleString("en-IN")}`
                      : "No rate"}
                    {s.valid_from || s.valid_to
                      ? ` · ${s.valid_from ?? "…"} to ${s.valid_to ?? "…"}`
                      : ""}
                  </p>
                </div>
                {canManage && (
                  <ConfirmActionButton
                    action={deleteSupplierServiceAction.bind(null, s.id, id)}
                    triggerLabel="Remove"
                    title={`Remove ${s.name}?`}
                    description="This service and its rate will be deleted."
                  />
                )}
              </div>
            ))}
            {canManage && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">Add service</summary>
                <div className="pt-3">
                  <EntityForm
                    action={addSupplierServiceAction.bind(null, id)}
                    submitLabel="Add service"
                    fields={[
                      { name: "name", label: "Service", required: true, wide: true },
                      { name: "unitRate", label: "Rate", type: "number", min: 0, step: "0.01" },
                      { name: "currency", label: "Currency", defaultValue: "INR" },
                      { name: "validFrom", label: "Valid from", type: "date" },
                      { name: "validTo", label: "Valid to", type: "date" },
                      { name: "description", label: "Details", type: "textarea" },
                    ]}
                  />
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
