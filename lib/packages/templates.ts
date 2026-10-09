export const TEMPLATE_KEYS = [
  "LUXURY_HOLIDAY",
  "HONEYMOON_SPECIAL",
  "FAMILY_VACATION",
  "ADVENTURE_TOUR",
  "PILGRIMAGE_TOUR",
  "GROUP_TOUR",
  "INTERNATIONAL_HOLIDAY",
  "DOMESTIC_TOUR",
  "BEACH_HOLIDAY",
  "WILDLIFE_NATURE",
  "CORPORATE_TRAVEL",
  "WEEKEND_GETAWAY",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export type Layout = "CLASSIC" | "MODERN" | "MAGAZINE";
export type Font = "SANS" | "SERIF";
export type Motif =
  | "gem"
  | "heart"
  | "family"
  | "peak"
  | "temple"
  | "group"
  | "globe"
  | "map"
  | "wave"
  | "leaf"
  | "briefcase"
  | "sun";

export type Theme = {
  primary: string;
  secondary: string;
  accent: string;
  font: Font;
  layout: Layout;
};

export type TemplateDef = {
  key: TemplateKey;
  name: string;
  description: string;
  motif: Motif;
  theme: Theme;
  /** Shown when staff have no photo yet: a tagline suited to this kind of trip. */
  tagline: string;
};

/**
 * Twelve original layouts. They use only colours, type and simple vector motifs drawn for this app: no stock photography
 * and no third-party artwork. Photos come from the agency's own library.
 */
export const TEMPLATES: TemplateDef[] = [
  {
    key: "LUXURY_HOLIDAY",
    name: "Luxury Holiday",
    description: "Refined serif layout with gold accents for premium stays.",
    motif: "gem",
    tagline: "Curated for those who expect the finest",
    theme: {
      primary: "#1f1a14",
      secondary: "#8a6d2f",
      accent: "#c9a24b",
      font: "SERIF",
      layout: "CLASSIC",
    },
  },
  {
    key: "HONEYMOON_SPECIAL",
    name: "Honeymoon Special",
    description: "Soft, romantic palette for couples' getaways.",
    motif: "heart",
    tagline: "Begin your forever somewhere beautiful",
    theme: {
      primary: "#9d2b52",
      secondary: "#c9567c",
      accent: "#f3b6c9",
      font: "SERIF",
      layout: "CLASSIC",
    },
  },
  {
    key: "FAMILY_VACATION",
    name: "Family Vacation",
    description: "Bright, friendly layout that is easy for everyone to read.",
    motif: "family",
    tagline: "Memories for every age",
    theme: {
      primary: "#0f766e",
      secondary: "#f97316",
      accent: "#facc15",
      font: "SANS",
      layout: "MODERN",
    },
  },
  {
    key: "ADVENTURE_TOUR",
    name: "Adventure Tour",
    description: "Bold, full-bleed look for treks, safaris and active trips.",
    motif: "peak",
    tagline: "Go further than the map",
    theme: {
      primary: "#14532d",
      secondary: "#ea580c",
      accent: "#fbbf24",
      font: "SANS",
      layout: "MAGAZINE",
    },
  },
  {
    key: "PILGRIMAGE_TOUR",
    name: "Pilgrimage Tour",
    description: "Calm, devotional tone with saffron highlights.",
    motif: "temple",
    tagline: "A journey of faith, comfortably arranged",
    theme: {
      primary: "#9a3412",
      secondary: "#d97706",
      accent: "#fde68a",
      font: "SERIF",
      layout: "CLASSIC",
    },
  },
  {
    key: "GROUP_TOUR",
    name: "Group Tour",
    description: "Clear schedule-first layout for fixed departures.",
    motif: "group",
    tagline: "Travel together, worry-free",
    theme: {
      primary: "#1d4ed8",
      secondary: "#0ea5e9",
      accent: "#fbbf24",
      font: "SANS",
      layout: "MODERN",
    },
  },
  {
    key: "INTERNATIONAL_HOLIDAY",
    name: "International Holiday",
    description: "Polished magazine layout for overseas packages.",
    motif: "globe",
    tagline: "The world, planned to the last detail",
    theme: {
      primary: "#1e3a8a",
      secondary: "#0891b2",
      accent: "#f59e0b",
      font: "SANS",
      layout: "MAGAZINE",
    },
  },
  {
    key: "DOMESTIC_TOUR",
    name: "Domestic Tour",
    description: "Warm, practical layout for trips within India.",
    motif: "map",
    tagline: "Discover more of India",
    theme: {
      primary: "#15803d",
      secondary: "#ea580c",
      accent: "#fcd34d",
      font: "SANS",
      layout: "MODERN",
    },
  },
  {
    key: "BEACH_HOLIDAY",
    name: "Beach Holiday",
    description: "Airy aqua palette with a large cover photo.",
    motif: "wave",
    tagline: "Sun, sand and slow mornings",
    theme: {
      primary: "#0e7490",
      secondary: "#06b6d4",
      accent: "#fcd34d",
      font: "SANS",
      layout: "MAGAZINE",
    },
  },
  {
    key: "WILDLIFE_NATURE",
    name: "Wildlife and Nature",
    description: "Earthy tones for safaris, hills and nature stays.",
    motif: "leaf",
    tagline: "Quiet places, wild company",
    theme: {
      primary: "#3f6212",
      secondary: "#a16207",
      accent: "#d9f99d",
      font: "SERIF",
      layout: "MAGAZINE",
    },
  },
  {
    key: "CORPORATE_TRAVEL",
    name: "Corporate Travel",
    description: "Restrained, businesslike layout for company trips.",
    motif: "briefcase",
    tagline: "Travel that works as hard as you do",
    theme: {
      primary: "#334155",
      secondary: "#0f766e",
      accent: "#94a3b8",
      font: "SANS",
      layout: "MODERN",
    },
  },
  {
    key: "WEEKEND_GETAWAY",
    name: "Weekend Getaway",
    description: "Short, punchy layout for quick breaks.",
    motif: "sun",
    tagline: "Two days. One great escape",
    theme: {
      primary: "#6d28d9",
      secondary: "#db2777",
      accent: "#fde047",
      font: "SANS",
      layout: "MODERN",
    },
  },
];

export const templateByKey = (key: string | null | undefined): TemplateDef =>
  TEMPLATES.find((t) => t.key === key) ?? TEMPLATES.find((t) => t.key === "DOMESTIC_TOUR")!;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The template's look with any saved overrides applied. Invalid overrides are ignored, never trusted. */
export function resolveTheme(
  key: string | null | undefined,
  overrides: Partial<Record<keyof Theme, unknown>> | null | undefined,
): Theme {
  const base = templateByKey(key).theme;
  const o = overrides ?? {};
  const color = (v: unknown, fb: string) => (typeof v === "string" && HEX.test(v) ? v : fb);
  return {
    primary: color(o.primary, base.primary),
    secondary: color(o.secondary, base.secondary),
    accent: color(o.accent, base.accent),
    font: o.font === "SANS" || o.font === "SERIF" ? o.font : base.font,
    layout:
      o.layout === "CLASSIC" || o.layout === "MODERN" || o.layout === "MAGAZINE"
        ? o.layout
        : base.layout,
  };
}

/** Readable text colour (black or white) for a given background. */
export function readableOn(hex: string): "#111827" | "#ffffff" {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111827" : "#ffffff";
}
