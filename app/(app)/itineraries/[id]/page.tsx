import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItineraryActions } from "@/components/itinerary/itinerary-actions";
import { ItineraryBuilder } from "@/components/itinerary/builder";
import { PageHeader } from "@/components/crm/page-header";
import { requireOrgSession } from "@/lib/auth/session";
import { uuid } from "@/lib/crm/schemas";
import { getItineraryDocument, listItineraryVersions } from "@/lib/itinerary/queries";

export const metadata: Metadata = { title: "Itinerary builder" };

export default async function ItineraryBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  const doc = await getItineraryDocument(id); // null for missing or other-organization ids (RLS)
  if (!doc) notFound();
  const versions = await listItineraryVersions(id);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={String(doc.title)}
        description={doc.isTemplate ? "Template" : undefined}
        actions={
          <ItineraryActions
            id={id}
            canCreate={session.permissions.has("itineraries.create")}
            canDelete={session.permissions.has("itineraries.delete")}
          />
        }
      />
      <ItineraryBuilder
        // Remount when the server version changes so editor state never drifts from the DB.
        key={`${id}-${String(doc.version)}`}
        id={id}
        initial={doc}
        versions={versions}
        canEdit={session.permissions.has("itineraries.update")}
      />
    </div>
  );
}
