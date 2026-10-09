import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm } from "@/components/forms/entity-form";
import { ImageManager } from "@/components/packages/image-manager";
import { PackagePreview } from "@/components/packages/package-preview";
import { PackageStatusButtons } from "@/components/packages/status-buttons";
import { TemplateGallery } from "@/components/packages/template-gallery";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import { uuid } from "@/lib/crm/schemas";
import { buildPackageDocument } from "@/lib/packages/document";
import { getPackageBundle, listPackageImages } from "@/lib/packages/queries";
import { templateByKey } from "@/lib/packages/templates";
import { savePackageDetailsAction } from "@/app/(app)/itineraries/[id]/package/actions";

export const metadata: Metadata = { title: "Package studio" };

const TABS = ["template", "details", "photos", "preview"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = {
  template: "1. Template",
  details: "2. Details and pricing",
  photos: "3. Photos",
  preview: "4. Preview and PDF",
};

const HOTELS = [
  { value: "BUDGET", label: "Budget" },
  { value: "THREE_STAR", label: "3 star" },
  { value: "FOUR_STAR", label: "4 star" },
  { value: "FIVE_STAR", label: "5 star" },
  { value: "LUXURY", label: "Luxury" },
  { value: "RESORT", label: "Resort" },
  { value: "HOMESTAY", label: "Homestay" },
];

export default async function PackageStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  const bundle = await getPackageBundle(id); // null for missing or other-organization ids (RLS)
  if (!bundle) notFound();
  const tabParam = (await searchParams).tab;
  const tab: Tab = TABS.find((t) => t === tabParam) ?? "template";
  const can = (p: string) => session.permissions.has(p);
  const canEdit = can("itineraries.update");
  const d = bundle.details;
  const tpl = templateByKey(bundle.templateKey);
  const doc = buildPackageDocument(bundle, session.organization.name);
  const base = `/itineraries/${id}/package`;
  const library = tab === "photos" ? await listPackageImages() : [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title={bundle.doc.title}
        description={`Package studio · ${tpl.name}`}
        actions={
          <>
            <StatusBadge value={bundle.status} />
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href={`/itineraries/${id}`} />}
            >
              Edit itinerary
            </Button>
            {canEdit && <PackageStatusButtons id={id} status={bundle.status} />}
          </>
        }
      />

      <nav aria-label="Package steps" className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`${base}?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${t === tab ? "border-primary font-medium" : "text-muted-foreground hover:text-foreground border-transparent"}`}
          >
            {LABEL[t]}
          </Link>
        ))}
      </nav>

      {tab === "template" && (
        <section aria-label="Choose a template" className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            Pick the look. Every template can be recoloured on the next step, and your photos,
            prices and itinerary are kept when you switch.
          </p>
          <TemplateGallery id={id} current={bundle.templateKey} canEdit={canEdit} />
        </section>
      )}

      {tab === "details" && (
        <Card>
          <CardContent>
            {!canEdit && (
              <p className="text-muted-foreground pb-3 text-sm">
                You can view these details but not change them.
              </p>
            )}
            <EntityForm
              action={savePackageDetailsAction.bind(null, id)}
              submitLabel="Save details"
              hidden={{ templateKey: bundle.templateKey }}
              fields={[
                {
                  name: "primary",
                  label: "Main colour",
                  defaultValue: (d?.theme?.primary as string | undefined) ?? tpl.theme.primary,
                  placeholder: tpl.theme.primary,
                },
                {
                  name: "secondary",
                  label: "Second colour",
                  defaultValue: (d?.theme?.secondary as string | undefined) ?? tpl.theme.secondary,
                },
                {
                  name: "accent",
                  label: "Accent colour",
                  defaultValue: (d?.theme?.accent as string | undefined) ?? tpl.theme.accent,
                },
                {
                  name: "font",
                  label: "Font style",
                  type: "select",
                  defaultValue: bundle.theme.font,
                  required: true,
                  options: [
                    { value: "SANS", label: "Clean sans-serif" },
                    { value: "SERIF", label: "Elegant serif" },
                  ],
                },
                {
                  name: "layout",
                  label: "Layout",
                  type: "select",
                  defaultValue: bundle.theme.layout,
                  required: true,
                  options: [
                    { value: "CLASSIC", label: "Classic (framed cover)" },
                    { value: "MODERN", label: "Modern (side band)" },
                    { value: "MAGAZINE", label: "Magazine (full-width cover)" },
                  ],
                },
                {
                  name: "returnDate",
                  label: "Return date (if different from the itinerary length)",
                  type: "date",
                  defaultValue: d?.return_date,
                },
                {
                  name: "hotelCategory",
                  label: "Hotel category",
                  type: "select",
                  options: HOTELS,
                  defaultValue: d?.hotel_category,
                },
                {
                  name: "accommodation",
                  label: "Accommodation details",
                  type: "textarea",
                  wide: true,
                  defaultValue: d?.accommodation,
                },
                {
                  name: "transport",
                  label: "Transport and transfers",
                  type: "textarea",
                  wide: true,
                  defaultValue: d?.transport,
                },
                {
                  name: "flights",
                  label: "Flight details (if included)",
                  type: "textarea",
                  wide: true,
                  defaultValue: d?.flights,
                },
                {
                  name: "meals",
                  label: "Meals included",
                  type: "textarea",
                  wide: true,
                  defaultValue: d?.meals,
                },
                {
                  name: "activities",
                  label: "Sightseeing and activities",
                  type: "textarea",
                  wide: true,
                  defaultValue: d?.activities,
                },
                {
                  name: "price",
                  label: "Package price",
                  type: "number",
                  min: 0,
                  step: "0.01",
                  defaultValue: d?.price,
                },
                { name: "currency", label: "Currency", defaultValue: d?.currency ?? "INR" },
                {
                  name: "priceNote",
                  label: "Price note",
                  defaultValue: d?.price_note,
                  placeholder: "per person on twin sharing",
                },
                {
                  name: "childPrice",
                  label: "Child price",
                  type: "number",
                  min: 0,
                  step: "0.01",
                  defaultValue: d?.child_price,
                },
                {
                  name: "extraPersonPrice",
                  label: "Extra person price",
                  type: "number",
                  min: 0,
                  step: "0.01",
                  defaultValue: d?.extra_person_price,
                },
                {
                  name: "cancellationPolicy",
                  label: "Cancellation policy",
                  type: "textarea",
                  wide: true,
                  defaultValue: d?.cancellation_policy,
                },
                {
                  name: "terms",
                  label: "Terms and conditions",
                  type: "textarea",
                  wide: true,
                  defaultValue: d?.terms,
                },
                {
                  name: "travelNotes",
                  label: "Important travel notes",
                  type: "textarea",
                  wide: true,
                  defaultValue: d?.travel_notes,
                },
                {
                  name: "ctaText",
                  label: "Booking call to action",
                  wide: true,
                  defaultValue: d?.cta_text,
                  placeholder: "Call us today to reserve your seats.",
                },
              ]}
            />
            <p className="text-muted-foreground pt-3 text-xs">
              Agency name, logo, phone, email and website come from Settings, Agency branding.
              Inclusions, exclusions, summary and the day plan come from the itinerary.
            </p>
          </CardContent>
        </Card>
      )}

      {tab === "photos" && (
        <ImageManager
          itineraryId={id}
          days={bundle.doc.days.length}
          links={bundle.links}
          library={library}
          canEdit={canEdit}
          canDelete={can("itineraries.delete")}
        />
      )}

      {tab === "preview" && (
        <section aria-label="Preview" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button
              size="sm"
              nativeButton={false}
              render={
                <a
                  href={`/api/itineraries/${id}/package-pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <Download className="size-4" aria-hidden /> Download PDF
            </Button>
            <p className="text-muted-foreground text-xs">
              The PDF uses the same template, photos and details as this preview. Edit and
              regenerate at any time; nothing is lost.
            </p>
          </div>
          <PackagePreview doc={doc} />
          <p className="text-muted-foreground flex items-center gap-1 text-xs print:hidden">
            <Printer className="size-3.5" aria-hidden /> To print, use your browser&apos;s print
            command on this page.
          </p>
        </section>
      )}
    </div>
  );
}
