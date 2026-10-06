import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { requireOrgSession } from "@/lib/auth/session";
import { uuid } from "@/lib/crm/schemas";
import { getLead } from "@/lib/crm/queries";
import { listTemplateOptions } from "@/lib/itinerary/queries";
import { createItineraryAction } from "@/app/(app)/itineraries/actions";

export const metadata: Metadata = { title: "New itinerary" };

export default async function NewItineraryPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("itineraries.create")) redirect("/itineraries");
  const sp = await searchParams;
  const leadId = sp.lead && uuid.safeParse(sp.lead).success ? sp.lead : undefined;
  const [lead, templates] = await Promise.all([
    leadId ? getLead(leadId) : Promise.resolve(null),
    listTemplateOptions(),
  ]);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <PageHeader
        title="New itinerary"
        description={lead ? `For lead: ${lead.title}` : undefined}
      />
      <div className="bg-card rounded-xl border p-5">
        <EntityForm
          action={createItineraryAction}
          submitLabel="Create and open builder"
          hidden={lead ? { leadId: lead.id } : undefined}
          fields={[
            {
              name: "title",
              label: "Title",
              required: true,
              wide: true,
              defaultValue: lead ? `${lead.destination ?? lead.title} itinerary` : undefined,
            },
            {
              name: "destination",
              label: "Destination",
              wide: true,
              defaultValue: lead?.destination,
            },
            ...(templates.length
              ? [
                  {
                    name: "templateId",
                    label: "Start from a template",
                    type: "select" as const,
                    wide: true,
                    options: templates,
                  },
                ]
              : []),
            {
              name: "asTemplate",
              label: "Create as a reusable template",
              type: "checkbox" as const,
            },
          ]}
        />
      </div>
    </div>
  );
}
