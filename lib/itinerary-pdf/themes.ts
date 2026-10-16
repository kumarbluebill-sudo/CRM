/** The five looks of the itinerary PDF. Plain hex values only, so they are safe in both the PDF and the HTML preview. */
export const PDF_THEME_KEYS = [
  "corporate-navy",
  "ocean-teal",
  "charcoal-minimal",
  "modern-bold",
  "emerald-executive",
] as const;
export type PdfThemeKey = (typeof PDF_THEME_KEYS)[number];

export type PdfTheme = {
  key: PdfThemeKey;
  name: string;
  blurb: string;
  /** Headings, cover band and table headers. */
  primary: string;
  /** Rules, small labels and highlights. */
  accent: string;
  /** Page text. */
  ink: string;
  /** Secondary text. */
  muted: string;
  /** Soft panels and zebra rows. */
  tint: string;
  /** Hairlines. */
  line: string;
  /** Text placed on `primary`. */
  onPrimary: string;
  /** Serif headings (Times) or sans (Helvetica). */
  serif: boolean;
};

export const PDF_THEMES: PdfTheme[] = [
  {
    key: "corporate-navy",
    name: "Corporate Navy",
    blurb: "Deep navy with a gold rule. Formal and trustworthy.",
    primary: "#12305c",
    accent: "#b8892b",
    ink: "#1b2433",
    muted: "#5c6678",
    tint: "#eef2f8",
    line: "#d5dce8",
    onPrimary: "#ffffff",
    serif: false,
  },
  {
    key: "ocean-teal",
    name: "Ocean Teal",
    blurb: "Fresh teal and coral. Good for beach and island trips.",
    primary: "#0e6b73",
    accent: "#e2674a",
    ink: "#16292b",
    muted: "#55696b",
    tint: "#e9f5f5",
    line: "#cde3e4",
    onPrimary: "#ffffff",
    serif: false,
  },
  {
    key: "charcoal-minimal",
    name: "Charcoal Minimal",
    blurb: "Charcoal and white with thin lines. Quiet and modern.",
    primary: "#2b2f36",
    accent: "#8a8f98",
    ink: "#1d2025",
    muted: "#646a73",
    tint: "#f3f4f6",
    line: "#dcdee2",
    onPrimary: "#ffffff",
    serif: false,
  },
  {
    key: "modern-bold",
    name: "Modern Bold",
    blurb: "Strong violet and orange blocks. Stands out on a phone.",
    primary: "#4b2bb0",
    accent: "#f08a1c",
    ink: "#1d1738",
    muted: "#625b80",
    tint: "#f1edfc",
    line: "#dcd4f3",
    onPrimary: "#ffffff",
    serif: false,
  },
  {
    key: "emerald-executive",
    name: "Emerald Executive",
    blurb: "Emerald with a serif heading. Premium and calm.",
    primary: "#0f5a43",
    accent: "#a67c2e",
    ink: "#14261f",
    muted: "#53655d",
    tint: "#eaf4ef",
    line: "#cfe3d9",
    onPrimary: "#ffffff",
    serif: true,
  },
];

export const DEFAULT_PDF_THEME: PdfThemeKey = "corporate-navy";

export function pdfTheme(key: string | null | undefined): PdfTheme {
  return PDF_THEMES.find((t) => t.key === key) ?? PDF_THEMES[0];
}

export const PDF_SECTION_KEYS = [
  "overview",
  "hotels",
  "days",
  "quotation",
  "inclusions",
  "cancellation",
  "terms",
  "bank",
] as const;
export type PdfSectionKey = (typeof PDF_SECTION_KEYS)[number];
export type PdfSections = Record<PdfSectionKey, boolean>;

export const PDF_SECTION_LABELS: Record<PdfSectionKey, string> = {
  overview: "Overview",
  hotels: "Hotels",
  days: "Day plan",
  quotation: "Quotation",
  inclusions: "Inclusions and exclusions",
  cancellation: "Cancellation policy",
  terms: "Terms and conditions",
  bank: "Bank details",
};

export const DEFAULT_SECTIONS: PdfSections = {
  overview: true,
  hotels: true,
  days: true,
  quotation: true,
  inclusions: true,
  cancellation: true,
  terms: true,
  bank: true,
};

/** What is saved with the package: the look, the toggles, and which quotation/option/photo to use. */
export type PdfSettings = {
  theme: PdfThemeKey;
  quotationId: string | null;
  optionId: string | null;
  coverImageId: string | null;
  sections: PdfSections;
};

export const DEFAULT_SETTINGS: PdfSettings = {
  theme: DEFAULT_PDF_THEME,
  quotationId: null,
  optionId: null,
  coverImageId: null,
  sections: DEFAULT_SECTIONS,
};

/** Reads saved settings defensively: anything unknown falls back to the default. */
export function parseSettings(raw: unknown): PdfSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sec = (r.sections && typeof r.sections === "object" ? r.sections : {}) as Record<string, unknown>;
  const sections = { ...DEFAULT_SECTIONS };
  for (const k of PDF_SECTION_KEYS) if (typeof sec[k] === "boolean") sections[k] = sec[k] as boolean;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    theme: pdfTheme(str(r.theme)).key,
    quotationId: str(r.quotationId),
    optionId: str(r.optionId),
    coverImageId: str(r.coverImageId),
    sections,
  };
}
