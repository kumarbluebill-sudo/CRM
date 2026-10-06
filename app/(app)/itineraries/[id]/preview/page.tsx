import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bed, Bus, MapPin, Plane, StickyNote, Utensils, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { uuid } from "@/lib/crm/schemas";
import { getItineraryDocument } from "@/lib/itinerary/queries";
import { toEditorDoc, type ItemType } from "@/lib/itinerary/schema";

export const metadata: Metadata = { title: "Itinerary preview" };

const ICONS: Record<ItemType, LucideIcon> = {
  ACTIVITY: MapPin,
  HOTEL: Bed,
  TRANSFER: Bus,
  MEAL: Utensils,
  FLIGHT: Plane,
  NOTE: StickyNote,
};

/** Plain preview. Agency branding and PDF export arrive with the quotation/PDF phase. */
export default async function ItineraryPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  const raw = await getItineraryDocument(id);
  if (!raw) notFound();
  const doc = toEditorDoc(raw);
  const start = doc.startDate ? new Date(`${doc.startDate}T00:00:00`) : null;
  const dateFor = (i: number) => {
    if (!start) return null;
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d.toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };
  const lines = (t: string) => t.split("\n").filter(Boolean);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={`/itineraries/${id}`} />}
        >
          Back to builder
        </Button>
        <p className="text-muted-foreground text-xs">
          {doc.status === "PUBLISHED" ? "Published" : "Draft – not yet published"} ·{" "}
          {session.organization.name}
        </p>
      </div>

      <header className="bg-card rounded-xl border p-8">
        <p className="text-muted-foreground text-xs tracking-widest uppercase">
          {doc.destination || "Itinerary"}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{doc.title}</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {doc.days.length} days · {doc.adults} adult{doc.adults === 1 ? "" : "s"}
          {doc.children ? ` · ${doc.children} child${doc.children === 1 ? "" : "ren"}` : ""}
        </p>
        {doc.summary && <p className="mt-4 whitespace-pre-wrap">{doc.summary}</p>}
      </header>

      {doc.days.map((day, i) => (
        <section key={day.key} className="bg-card break-inside-avoid rounded-xl border p-6">
          <h2 className="text-lg font-semibold">
            Day {i + 1}
            {day.title ? ` – ${day.title}` : ""}
          </h2>
          {dateFor(i) && <p className="text-muted-foreground text-xs">{dateFor(i)}</p>}
          {day.description && <p className="mt-2 text-sm whitespace-pre-wrap">{day.description}</p>}
          <ul className="mt-4 flex flex-col gap-3">
            {day.items.map((it) => {
              const Icon = ICONS[it.type];
              const safeImage = /^https:\/\//i.test(it.imageUrl) ? it.imageUrl : null;
              return (
                <li key={it.key} className="flex gap-3 text-sm">
                  <Icon
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    aria-label={label(it.type)}
                  />
                  <div>
                    <p className="font-medium">
                      {it.time && (
                        <span className="text-muted-foreground mr-2 font-normal">{it.time}</span>
                      )}
                      {it.title}
                    </p>
                    {it.location && <p className="text-muted-foreground text-xs">{it.location}</p>}
                    {it.description && <p className="mt-1 whitespace-pre-wrap">{it.description}</p>}
                    {safeImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={safeImage}
                        alt={it.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="mt-2 max-h-48 rounded-lg"
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {day.notes && <p className="text-muted-foreground mt-3 text-xs">Note: {day.notes}</p>}
        </section>
      ))}

      {(doc.inclusions || doc.exclusions) && (
        <section className="bg-card grid gap-6 rounded-xl border p-6 sm:grid-cols-2">
          {doc.inclusions && (
            <div>
              <h2 className="font-semibold">Inclusions</h2>
              <ul className="mt-2 list-disc pl-5 text-sm">
                {lines(doc.inclusions).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          )}
          {doc.exclusions && (
            <div>
              <h2 className="font-semibold">Exclusions</h2>
              <ul className="mt-2 list-disc pl-5 text-sm">
                {lines(doc.exclusions).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {doc.notes && (
        <p className="text-muted-foreground text-sm whitespace-pre-wrap">{doc.notes}</p>
      )}
    </div>
  );
}
