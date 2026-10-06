import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EntityForm } from "@/components/forms/entity-form";
import { leadFields } from "@/components/crm/lead-fields";
import { PageHeader } from "@/components/crm/page-header";
import { requireOrgSession } from "@/lib/auth/session";
import { listCustomerOptions, listLeadSourceOptions, listTeamMembers } from "@/lib/crm/queries";
import { uuid } from "@/lib/crm/schemas";
import { createLeadAction } from "@/app/(app)/leads/actions";

export const metadata: Metadata = { title: "New lead" };

export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("leads.create")) redirect("/leads");
  const { customer } = await searchParams;
  const [customers, sources, team] = await Promise.all([
    listCustomerOptions(),
    listLeadSourceOptions(),
    listTeamMembers(),
  ]);
  const defaultCustomerId = customer && uuid.safeParse(customer).success ? customer : undefined;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader title="New lead" />
      <div className="bg-card rounded-xl border p-5">
        <EntityForm
          action={createLeadAction}
          submitLabel="Create lead"
          fields={leadFields({ customers, sources, team, defaultCustomerId })}
        />
      </div>
    </div>
  );
}
