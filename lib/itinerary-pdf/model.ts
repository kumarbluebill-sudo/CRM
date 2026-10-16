import {
  DEFAULT_SECTIONS,
  type PdfSections,
  type PdfSettings,
  type PdfThemeKey,
} from "@/lib/itinerary-pdf/themes";

/**
 * The page model of the itinerary PDF. It is built from plain data and shared by the PDF renderer and the on-screen
 * preview, so both always show the same thing.
 *
 * Internal costs never enter this file: the input types below have no cost or markup fields, and every object is copied
 * field by field (never spread), so an extra property in the raw data cannot reach the PDF.
 */

export type SourceItem = {
  type: string;
  title: string;
  description?: string | null;
  location?: string | null;
  time?: string | null;
};
export type SourceDay = {
  title?: string | null;
  description?: string | null;
  notes?: string | null;
  items?: SourceItem[];
};
export type SourceItinerary = {
  title: string;
  destination?: string | null;
  summary?: string | null;
  startDate?: string | null;
  adults?: number | null;
  children?: number | null;
  inclusions?: string[];
  exclusions?: string[];
  notes?: string | null;
  days: SourceDay[];
};
export type SourcePackage = {
  returnDate?: string | null;
  hotelCategory?: string | null;
  accommodation?: string | null;
  transport?: string | null;
  flights?: string | null;
  meals?: string | null;
  activities?: string | null;
  cancellationPolicy?: string | null;
  terms?: string | null;
  travelNotes?: string | null;
};
export type SourceQuoteLine = {
  type?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};
export type SourceQuoteOption = {
  id: string;
  name: string;
  discountType?: string | null;
  discountValue?: number | null;
  taxRate?: number | null;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  items: SourceQuoteLine[];
};
export type SourceQuotation = {
  id: string;
  number: string;
  title?: string | null;
  currency: string;
  validUntil?: string | null;
  intro?: string | null;
  terms?: string | null;
  cancellationPolicy?: string | null;
  paymentTerms?: string | null;
  selectedOptionId?: string | null;
  options: SourceQuoteOption[];
};
export type SourceBranding = {
  name: string;
  logo?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  gst?: string | null;
  footer?: string | null;
};
export type SourcePayment = {
  bankName?: string | null;
  accountName?: string | null;
  accountNo?: string | null;
  ifsc?: string | null;
  upi?: string | null;
  signature?: string | null;
} | null;
export type SourceDefaults = { terms?: string | null; cancellationPolicy?: string | null };

export type PdfSource = {
  itinerary: SourceItinerary;
  package: SourcePackage | null;
  /** Every quotation linked to this itinerary; the settings choose one. */
  quotations: SourceQuotation[];
  customerName: string | null;
  branding: SourceBranding;
  payment: SourcePayment;
  defaults: SourceDefaults;
  /** Photo ids for each day (index 0 = day 1) and the cover candidates in library order. */
  dayImageIds: (string | null)[];
  fallbackCoverId: string | null;
};

export type ModelDay = {
  number: number;
  /** ISO date, or null when the trip has no start date. */
  date: string | null;
  dateText: string;
  title: string;
  description: string;
  items: { type: string; title: string; detail: string; time: string }[];
  imageId: string | null;
};

export type ModelQuote = {
  quotationNumber: string;
  optionName: string;
  currency: string;
  lines: { description: string; quantity: number; rate: number; amount: number }[];
  subtotal: number;
  discount: number;
  discountLabel: string;
  taxRate: number;
  tax: number;
  total: number;
  travellers: number;
  /** Total divided by travellers, or null when there are no travellers. */
  perPerson: number | null;
  validUntil: string | null;
  validUntilText: string | null;
  intro: string | null;
};

export type ModelPage =
  | { kind: "cover" }
  | { kind: "overview" }
  | { kind: "days"; days: ModelDay[] }
  | { kind: "quote" }
  | { kind: "policies" };

export type HotelRow = { name: string; detail: string };

export type ItineraryPdfModel = {
  themeKey: PdfThemeKey;
  title: string;
  destination: string;
  customer: string | null;
  durationText: string;
  nights: number;
  dayCount: number;
  startDateText: string | null;
  endDateText: string | null;
  travellersText: string;
  route: string;
  summary: string;
  highlights: string[];
  hotels: HotelRow[];
  transport: string | null;
  flights: string | null;
  meals: string | null;
  days: ModelDay[];
  quote: ModelQuote | null;
  inclusions: string[];
  exclusions: string[];
  cancellation: string | null;
  paymentTerms: string | null;
  terms: string | null;
  bank: { label: string; value: string }[];
  signature: string | null;
  validUntilText: string | null;
  branding: SourceBranding;
  coverImageId: string | null;
  sections: PdfSections;
  pages: ModelPage[];
};

/** Days shown on each day page. */
export const DAYS_PER_PAGE = 3;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** start_date + (dayNumber - 1), as an ISO date. Works in UTC so a time zone can never shift the day. */
export function dayDate(start: string | null | undefined, dayNumber: number): string | null {
  if (!start || !ISO.test(start)) return null;
  const d = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + (dayNumber - 1));
  return d.toISOString().slice(0, 10);
}

/** "12 Mar 2026". */
export function dateText(iso: string | null | undefined): string | null {
  if (!iso || !ISO.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Thu, 12 Mar 2026". */
export function dateWithWeekday(iso: string | null | undefined): string | null {
  const t = dateText(iso);
  if (!t || !iso) return null;
  return `${WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]}, ${t}`;
}

const paise = (n: number) => Math.round(n * 100);

/** Total split between the travellers, in whole paise. Null when nobody is travelling. */
export function perPersonAmount(total: number, travellers: number): number | null {
  if (!Number.isFinite(total) || !Number.isFinite(travellers) || travellers < 1) return null;
  return Math.round(paise(total) / travellers) / 100;
}

const lines = (t: string | null | undefined) =>
  (t ?? "")
    .split("\n")
    .map((l) => l.replace(/^[\s•\-*]+/, "").trim())
    .filter(Boolean);

const clean = (s: string | null | undefined) => (s ?? "").trim();
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const typeLabel = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();

/** Chooses the quotation and option to print: the saved choice, else the first quotation and its selected option. */
export function pickQuote(
  quotations: SourceQuotation[],
  settings: Pick<PdfSettings, "quotationId" | "optionId">,
): { quotation: SourceQuotation; option: SourceQuoteOption } | null {
  const q = quotations.find((x) => x.id === settings.quotationId) ?? quotations[0];
  if (!q || q.options.length === 0) return null;
  const o =
    q.options.find((x) => x.id === settings.optionId) ??
    q.options.find((x) => x.id === q.selectedOptionId) ??
    q.options[0];
  return { quotation: q, option: o };
}

export function buildItineraryPdfModel(
  src: PdfSource,
  settings: PdfSettings,
  opts: { showSections?: PdfSections } = {},
): ItineraryPdfModel {
  const sections = opts.showSections ?? settings.sections ?? DEFAULT_SECTIONS;
  const it = src.itinerary;
  const pkg = src.package;
  const dayCount = it.days.length;
  const nights = Math.max(0, dayCount - 1);
  const adults = Math.max(0, Math.floor(num(it.adults)));
  const children = Math.max(0, Math.floor(num(it.children)));
  const travellers = adults + children;

  const days: ModelDay[] = it.days.map((d, i) => {
    const number = i + 1;
    const date = dayDate(it.startDate, number);
    return {
      number,
      date,
      dateText: dateWithWeekday(date) ?? `Day ${number}`,
      title: clean(d.title) || `Day ${number}`,
      description: clean(d.description),
      items: (d.items ?? []).map((x) => ({
        type: x.type,
        title: clean(x.title),
        detail: [clean(x.description), clean(x.location)].filter(Boolean).join(" · "),
        time: clean(x.time),
      })),
      imageId: src.dayImageIds[i] ?? null,
    };
  });

  const hotels: HotelRow[] = lines(pkg?.accommodation).map((l) => {
    const [name, ...rest] = l.split(/\s+[-–—]\s+|:\s+/);
    return { name: name.trim(), detail: rest.join(" – ").trim() };
  });
  if (hotels.length === 0) {
    const seen = new Set<string>();
    for (const d of days)
      for (const x of d.items)
        if (x.type === "HOTEL" && x.title && !seen.has(x.title)) {
          seen.add(x.title);
          hotels.push({ name: x.title, detail: `Day ${d.number}${x.detail ? ` · ${x.detail}` : ""}` });
        }
  }

  const highlights: string[] = [];
  for (const l of lines(pkg?.activities)) if (highlights.length < 6) highlights.push(l);
  if (highlights.length === 0) {
    for (const d of days)
      for (const x of d.items)
        if (x.type === "ACTIVITY" && x.title && !highlights.includes(x.title) && highlights.length < 6)
          highlights.push(x.title);
  }
  if (highlights.length === 0)
    for (const d of days) if (d.title && highlights.length < 6) highlights.push(d.title);

  const picked = pickQuote(src.quotations, settings);
  let quote: ModelQuote | null = null;
  if (picked) {
    const { quotation: q, option: o } = picked;
    const discountLabel =
      o.discountType === "PERCENT"
        ? `Discount (${num(o.discountValue)}%)`
        : o.discountType === "FIXED"
          ? "Discount"
          : "Discount";
    quote = {
      quotationNumber: q.number,
      optionName: o.name,
      currency: q.currency || "INR",
      lines: o.items.map((x) => ({
        description: clean(x.description),
        quantity: num(x.quantity),
        rate: num(x.unitPrice),
        amount: num(x.lineTotal),
      })),
      subtotal: num(o.subtotal),
      discount: num(o.discountAmount),
      discountLabel,
      taxRate: num(o.taxRate),
      tax: num(o.taxAmount),
      total: num(o.total),
      travellers,
      perPerson: perPersonAmount(num(o.total), travellers),
      validUntil: q.validUntil ?? null,
      validUntilText: dateText(q.validUntil),
      intro: clean(q.intro) || null,
    };
  }

  const cancellation =
    clean(picked?.quotation.cancellationPolicy) ||
    clean(pkg?.cancellationPolicy) ||
    clean(src.defaults.cancellationPolicy) ||
    null;
  const terms =
    clean(picked?.quotation.terms) || clean(pkg?.terms) || clean(src.defaults.terms) || null;
  const pay = src.payment;
  const bank: { label: string; value: string }[] = [];
  if (pay) {
    if (clean(pay.bankName)) bank.push({ label: "Bank", value: clean(pay.bankName) });
    if (clean(pay.accountName)) bank.push({ label: "Account name", value: clean(pay.accountName) });
    if (clean(pay.accountNo)) bank.push({ label: "Account number", value: clean(pay.accountNo) });
    if (clean(pay.ifsc)) bank.push({ label: "IFSC", value: clean(pay.ifsc) });
    if (clean(pay.upi)) bank.push({ label: "UPI", value: clean(pay.upi) });
  }

  const start = dateText(it.startDate);
  const end = dateText(dayDate(it.startDate, Math.max(1, dayCount)));
  const route = (() => {
    const stops = lines(it.destination?.replace(/[,>→]/g, "\n"));
    return stops.length > 1 ? stops.join(" → ") : clean(it.destination);
  })();

  const inclusions = (it.inclusions ?? []).map(clean).filter(Boolean);
  const exclusions = (it.exclusions ?? []).map(clean).filter(Boolean);

  const showQuote = sections.quotation && quote !== null;
  const showPolicies =
    (sections.inclusions && (inclusions.length > 0 || exclusions.length > 0)) ||
    (sections.cancellation && !!cancellation) ||
    (sections.terms && !!terms) ||
    (sections.bank && bank.length > 0) ||
    (showQuote && !!clean(picked?.quotation.paymentTerms));

  const pages: ModelPage[] = [{ kind: "cover" }];
  if (sections.overview) pages.push({ kind: "overview" });
  if (sections.days)
    for (let i = 0; i < days.length; i += DAYS_PER_PAGE)
      pages.push({ kind: "days", days: days.slice(i, i + DAYS_PER_PAGE) });
  if (showQuote) pages.push({ kind: "quote" });
  if (showPolicies) pages.push({ kind: "policies" });

  return {
    themeKey: settings.theme,
    title: clean(it.title) || "Your itinerary",
    destination: clean(it.destination),
    customer: src.customerName ? clean(src.customerName) : null,
    durationText: dayCount > 0 ? `${nights} night${nights === 1 ? "" : "s"} / ${dayCount} day${dayCount === 1 ? "" : "s"}` : "",
    nights,
    dayCount,
    startDateText: start,
    endDateText: start ? end : null,
    travellersText:
      travellers > 0
        ? [adults ? `${adults} adult${adults === 1 ? "" : "s"}` : "", children ? `${children} child${children === 1 ? "" : "ren"}` : ""]
            .filter(Boolean)
            .join(", ")
        : "",
    route,
    summary: clean(it.summary),
    highlights,
    hotels: sections.hotels ? hotels : [],
    transport: clean(pkg?.transport) || null,
    flights: clean(pkg?.flights) || null,
    meals: clean(pkg?.meals) || null,
    days,
    quote: showQuote ? quote : null,
    inclusions: sections.inclusions ? inclusions : [],
    exclusions: sections.inclusions ? exclusions : [],
    cancellation: sections.cancellation ? cancellation : null,
    paymentTerms: showQuote ? clean(picked?.quotation.paymentTerms) || null : null,
    terms: sections.terms ? terms : null,
    bank: sections.bank ? bank : [],
    signature: sections.bank ? (pay?.signature ?? null) : null,
    validUntilText: showQuote ? dateText(picked?.quotation.validUntil) : null,
    branding: {
      name: clean(src.branding.name),
      logo: src.branding.logo ?? null,
      phone: src.branding.phone ?? null,
      whatsapp: src.branding.whatsapp ?? null,
      email: src.branding.email ?? null,
      website: src.branding.website ?? null,
      address: src.branding.address ?? null,
      gst: src.branding.gst ?? null,
      footer: src.branding.footer ?? null,
    },
    coverImageId: settings.coverImageId ?? src.fallbackCoverId,
    sections,
    pages,
  };
}

export { typeLabel };

type Loose = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const numv = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/** Copies a quotation document field by field. Cost and markup fields are never read, even if present. */
export function toSourceQuotation(raw: Loose): SourceQuotation {
  const options = (Array.isArray(raw.options) ? raw.options : []) as Loose[];
  return {
    id: String(raw.id),
    number: String(raw.number ?? ""),
    title: str(raw.title),
    currency: str(raw.currency) ?? "INR",
    validUntil: str(raw.validUntil),
    intro: str(raw.intro),
    terms: str(raw.terms),
    cancellationPolicy: str(raw.cancellationPolicy),
    paymentTerms: str(raw.paymentTerms),
    selectedOptionId: str(raw.selectedOptionId),
    options: options.map((o) => ({
      id: String(o.id),
      name: String(o.name ?? "Option"),
      discountType: str(o.discountType),
      discountValue: numv(o.discountValue),
      taxRate: numv(o.taxRate),
      subtotal: numv(o.subtotal),
      discountAmount: numv(o.discountAmount),
      taxAmount: numv(o.taxAmount),
      total: numv(o.total),
      items: ((Array.isArray(o.items) ? o.items : []) as Loose[]).map((i) => ({
        type: str(i.type),
        description: String(i.description ?? ""),
        quantity: numv(i.quantity),
        unitPrice: numv(i.unitPrice),
        lineTotal: numv(i.lineTotal),
      })),
    })),
  };
}

