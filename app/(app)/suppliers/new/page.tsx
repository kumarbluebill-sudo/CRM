import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supplierFields } from "@/components/booking/supplier-fields";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { requireOrgSession } from "@/lib/auth/session";
import { createSupplierAction } from "@/app/(app)/suppliers/actions";

export const metadata: Metadata = { title: "New supplier" };

export default async function NewSupplierPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("suppliers.manage")) redirect("/suppliers");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader title="New supplier" />
      <div className="bg-card rounded-xl border p-5">
        <EntityForm
          action={createSupplierAction}
          submitLabel="Create supplier"
          fields={supplierFields()}
        />
      </div>
    </div>
  );
}
