import { label } from "@/lib/crm/constants";
import type { PackageBundle } from "@/lib/packages/queries";
import { templateByKey, type Theme } from "@/lib/packages/templates";

export type DocDay = {
  number: number;
  title: string;
  date: string | null;
  description: string;
  items: { type: string; title: string; description: string; time: string }[];
  imageIds: string[];
};

export type PackageDocument = {
  title: string;
  destination: string;
  tagline: string;
  durationText: string;
  startDate: string | null;
  returnDate: string | null;
  travellers: string;
  hotelCategory: string | null;
  summary: string;
  accommodation: string | null;
  transport: string | null;
  flights: string | null;
  meals: string | null;
  activities: string | null;
  days: DocDay[];
  inclusions: string[];
  exclusions: string[];
  price: {
    amount: number | null;
    currency: string;
    note: string | null;
    child: number | null;
    extra: number | null;
  };
  cancellationPolicy: string | null;
  terms: string | null;
  travelNotes: string | null;
  cta: string;
  contact: {
    name: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
    whatsapp: string | null;
  };
  logo: string | null;
  coverId: string | null;
  galleryIds: string[];
  hotelIds: string[];
  theme: Theme;
  templateName: string;
  draft: boolean;
};

const lines = (t: string) =>
  t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function buildPackageDocument(b: PackageBundle, orgName: string): PackageDocument {
  const d = b.details;
  const tpl = templateByKey(b.templateKey);
  const days = b.doc.days.length;
  const nights = Math.max(0, days - 1);
  const ids = (role: string, day?: number) =>
    b.links
      .filter((l) => l.role === role && (day === undefined || l.day_number === day))
      .map((l) => l.image_id);
  const br = b.branding;
  const adults = b.doc.adults;
  const children = b.doc.children;
  return {
    title: b.doc.title,
    destination: b.doc.destination,
    tagline: tpl.tagline,
    durationText:
      days > 0
        ? `${days} ${days === 1 ? "Day" : "Days"}${nights ? ` / ${nights} ${nights === 1 ? "Night" : "Nights"}` : ""}`
        : "",
    startDate: b.doc.startDate || null,
    returnDate:
      d?.return_date ?? (b.doc.startDate && days > 0 ? addDays(b.doc.startDate, days - 1) : null),
    travellers: [
      adults ? `${adults} ${adults === 1 ? "adult" : "adults"}` : "",
      children ? `${children} ${children === 1 ? "child" : "children"}` : "",
    ]
      .filter(Boolean)
      .join(", "),
    hotelCategory: d?.hotel_category ? label(d.hotel_category) : null,
    summary: b.doc.summary,
    accommodation: d?.accommodation ?? null,
    transport: d?.transport ?? null,
    flights: d?.flights ?? null,
    meals: d?.meals ?? null,
    activities: d?.activities ?? null,
    days: b.doc.days.map((day, i) => ({
      number: i + 1,
      title: day.title || `Day ${i + 1}`,
      date: b.doc.startDate ? addDays(b.doc.startDate, i) : null,
      description: day.description,
      items: day.items.map((it) => ({
        type: it.type,
        title: it.title,
        description: it.description,
        time: it.time,
      })),
      imageIds: ids("DAY", i + 1),
    })),
    inclusions: lines(b.doc.inclusions),
    exclusions: lines(b.doc.exclusions),
    price: {
      amount: d?.price != null ? Number(d.price) : null,
      currency: d?.currency ?? "INR",
      note: d?.price_note ?? null,
      child: d?.child_price != null ? Number(d.child_price) : null,
      extra: d?.extra_person_price != null ? Number(d.extra_person_price) : null,
    },
    cancellationPolicy: d?.cancellation_policy ?? null,
    terms: d?.terms ?? null,
    travelNotes: [d?.travel_notes, b.doc.notes].filter(Boolean).join("\n\n") || null,
    cta: d?.cta_text || "Contact us to book this package.",
    contact: {
      name: br?.trade_name || br?.legal_name || orgName,
      phone: br?.phone ?? null,
      email: br?.email ?? null,
      website: br?.website ?? null,
      address: br?.address ?? null,
      whatsapp: br?.whatsapp ?? null,
    },
    logo: br?.logo_data ?? null,
    coverId: ids("COVER")[0] ?? null,
    galleryIds: ids("GALLERY"),
    hotelIds: ids("HOTEL"),
    theme: b.theme,
    templateName: tpl.name,
    draft: b.status !== "PUBLISHED",
  };
}
