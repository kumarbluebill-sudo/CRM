import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getPackageBundle, listPackageImages } from "@/lib/packages/queries";
import { readStoredImage } from "@/lib/packages/images";
import { getQuotationDocument } from "@/lib/quotation/queries";
import { parseSettings, type PdfSettings } from "@/lib/itinerary-pdf/themes";
import {
  toSourceQuotation,
  type PdfSource,
  type SourceBranding,
  type SourcePayment,
  type SourceQuotation,
} from "@/lib/itinerary-pdf/model";
import { logger } from "@/lib/utils/logger";

type Loose = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const lines = (t: string) =>
  t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export type StudioData = {
  source: PdfSource;
  settings: PdfSettings;
  /** For the pickers: every quotation on this itinerary, and every cover candidate. */
  quotationChoices: { id: string; number: string; title: string; options: { id: string; name: string; total: number }[]; selectedOptionId: string | null; currency: string }[];
  imageChoices: { id: string; name: string }[];
  customerId: string | null;
  customerContact: { name: string; phone: string | null; whatsapp: string | null } | null;
  itineraryTitle: string;
  organizationName: string;
};

/** Everything the Studio, the preview and the PDF need, read under the caller's own session (so row-level security applies). */
export async function loadStudioData(id: string, orgName: string): Promise<StudioData | null> {
  const bundle = await getPackageBundle(id);
  if (!bundle) return null;
  const supabase = await createClient();
  const d = bundle.details;
  const doc = bundle.doc;

  const [{ data: qrows }, { data: customer }, { data: orgSettings }, { data: pay }, library] = await Promise.all([
    supabase.from("quotations").select("id").eq("itinerary_id", id).order("created_at", { ascending: false }).limit(10),
    doc.customerId
      ? supabase.from("customers").select("id, name, phone, whatsapp").eq("id", doc.customerId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("organization_settings").select("default_terms, default_cancellation_policy").maybeSingle(),
    supabase.rpc("itinerary_pdf_payment_details"),
    listPackageImages(60),
  ]);

  const quotations: SourceQuotation[] = [];
  for (const r of qrows ?? []) {
    // always the customer-facing version: priv = false, so costs are not even loaded
    const q = await getQuotationDocument(r.id as string, false);
    if (q) quotations.push(toSourceQuotation(q as Loose));
  }

  const br = bundle.branding;
  const branding: SourceBranding = {
    name: br?.trade_name || br?.legal_name || orgName,
    logo: br?.logo_data ?? null,
    phone: br?.phone ?? null,
    whatsapp: br?.whatsapp ?? null,
    email: br?.email ?? null,
    website: br?.website ?? null,
    address: br?.address ?? null,
    gst: br?.gst_number ?? null,
    footer: br?.footer_text ?? null,
  };
  const p = (pay ?? null) as Loose | null;
  const payment: SourcePayment = p
    ? {
        bankName: str(p.bankName),
        accountName: str(p.accountName),
        accountNo: str(p.accountNo),
        ifsc: str(p.ifsc),
        upi: str(p.upi),
        signature: str(p.signature),
      }
    : null;

  const dayImageIds = doc.days.map(
    (_, i) => bundle.links.find((l) => l.role === "DAY" && l.day_number === i + 1)?.image_id ?? null,
  );
  const cover = bundle.links.find((l) => l.role === "COVER")?.image_id ?? null;

  const settings = parseSettings((d as unknown as { pdf_settings?: unknown } | null)?.pdf_settings);
  const source: PdfSource = {
    itinerary: {
      title: doc.title,
      destination: doc.destination,
      summary: doc.summary,
      startDate: doc.startDate || null,
      adults: doc.adults,
      children: doc.children,
      inclusions: lines(doc.inclusions),
      exclusions: lines(doc.exclusions),
      notes: doc.notes,
      days: doc.days.map((day) => ({
        title: day.title,
        description: day.description,
        notes: day.notes,
        items: day.items.map((i) => ({
          type: i.type,
          title: i.title,
          description: i.description,
          location: i.location,
          time: i.time,
        })),
      })),
    },
    package: d
      ? {
          returnDate: d.return_date,
          hotelCategory: d.hotel_category,
          accommodation: d.accommodation,
          transport: d.transport,
          flights: d.flights,
          meals: d.meals,
          activities: d.activities,
          cancellationPolicy: d.cancellation_policy,
          terms: d.terms,
          travelNotes: d.travel_notes,
        }
      : null,
    quotations,
    customerName: (customer as Loose | null)?.name ? String((customer as Loose).name) : null,
    branding,
    payment,
    defaults: {
      terms: str((orgSettings as Loose | null)?.default_terms),
      cancellationPolicy: str((orgSettings as Loose | null)?.default_cancellation_policy),
    },
    dayImageIds,
    fallbackCoverId: cover,
  };

  const c = customer as Loose | null;
  return {
    source,
    settings,
    quotationChoices: quotations.map((q) => ({
      id: q.id,
      number: q.number,
      title: q.title ?? "",
      currency: q.currency,
      selectedOptionId: q.selectedOptionId ?? null,
      options: q.options.map((o) => ({ id: o.id, name: o.name, total: o.total })),
    })),
    imageChoices: library.map((i) => ({ id: i.id, name: i.alt || i.name })),
    customerId: c ? String(c.id) : null,
    customerContact: c
      ? { name: String(c.name), phone: str(c.phone), whatsapp: str(c.whatsapp) }
      : null,
    itineraryTitle: doc.title,
    organizationName: orgName,
  };
}

/** Photo ids the chosen settings will print, read from private storage and embedded as data URIs (nothing is hotlinked). */
export async function loadPdfImages(
  ids: (string | null | undefined)[],
): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter(Boolean) as string[])];
  const images: Record<string, string> = {};
  if (wanted.length === 0) return images;
  const supabase = await createClient();
  const { data: rows } = await supabase.from("package_images").select("id, storage_path").in("id", wanted);
  await Promise.all(
    (rows ?? []).map(async (r) => {
      try {
        images[r.id as string] =
          `data:image/jpeg;base64,${(await readStoredImage(r.storage_path as string)).toString("base64")}`;
      } catch (e) {
        logger.warn("itinerary pdf image skipped", { error: e instanceof Error ? e.message : "unknown" });
      }
    }),
  );
  return images;
}
