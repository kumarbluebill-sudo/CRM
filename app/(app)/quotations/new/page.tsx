import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { requireOrgSession } from "@/lib/auth/session";
import { getLead } from "@/lib/crm/queries";
import { uuid } from "@/lib/crm/schemas";
import { listCustomerOptionsWithId, listTemplates } from "@/lib/quotation/queries";
import { createQuotationAction } from "@/app/(app)/quotations/actions";

export const metadata: Metadata = { title: "New quotation" };

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; customer?: string; itinerary?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("quotes.create")) redirect("/quotations");
  const sp = await searchParams;
  const ok = (v?: string) => (v && uuid.safeParse(v).success ? v : undefined);
  const leadId = ok(sp.lead);
  const [lead, customers, templates] = await Promise.all([
    leadId ? getLead(leadId) : Promise.resolve(null),
    listCustomerOptionsWithId(),
    listTemplates(),
  ]);
  const customerId = lead?.customer_id ?? ok(sp.customer);
  const itineraryId = ok(sp.itinerary);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <PageHeader
        title="New quotation"
        description={lead ? `For lead: ${lead.title}` : undefined}
      />
      <div className="bg-card rounded-xl border p-5">
        {customers.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Create a customer first, then come back to prepare a quotation.
          </p>
        ) : (
          <EntityForm
            action={createQuotationAction}
            submitLabel="Create and open builder"
            hidden={{ ...(leadId ? { leadId } : {}), ...(itineraryId ? { itineraryId } : {}) }}
            fields={[
              {
                name: "customerId",
                label: "Customer",
                type: "select",
                required: true,
                options: customers,
                defaultValue: customerId,
                wide: true,
              },
              {
                name: "title",
                label: "Title",
                required: true,
                wide: true,
                defaultValue: lead ? `${lead.destination ?? lead.title} quotation` : undefined,
              },
              { name: "currency", label: "Currency", defaultValue: lead?.currency ?? "INR" },
              ...(templates.length
                ? [
                    {
                      name: "templateId",
                      label: "Terms template",
                      type: "select" as const,
                      options: templates.map((t) => ({ value: t.id, label: t.name })),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </div>
    </div>
  );
}
