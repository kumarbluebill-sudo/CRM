import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { customerFields } from "@/components/crm/customer-fields";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { requireOrgSession } from "@/lib/auth/session";
import { createCustomerAction } from "@/app/(app)/customers/actions";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("customers.create")) redirect("/customers");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader title="New customer" />
      <div className="bg-card rounded-xl border p-5">
        <EntityForm
          action={createCustomerAction}
          submitLabel="Create customer"
          fields={customerFields()}
        />
      </div>
    </div>
  );
}
