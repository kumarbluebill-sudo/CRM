import { hslToHex, mix } from "@/lib/theme/color";

/** The twelve colours a person can choose. Every other token is derived from these (see css.ts). */
export const COLOR_KEYS = [
  "primary",
  "accent",
  "sidebar",
  "sidebarText",
  "sidebarActive",
  "sidebarActiveText",
  "background",
  "surface",
  "border",
  "button",
  "text",
  "muted",
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export type Palette = Record<ColorKey, string>;

export const COLOR_LABELS: Record<ColorKey, string> = {
  primary: "Primary colour",
  accent: "Accent colour",
  sidebar: "Sidebar background",
  sidebarText: "Sidebar text",
  sidebarActive: "Active menu background",
  sidebarActiveText: "Active menu text",
  background: "Main page background",
  surface: "Card and panel background",
  border: "Border colour",
  button: "Button colour",
  text: "Text colour",
  muted: "Muted text colour",
};

export const PRESET_IDS = [
  "professional-blue",
  "modern-purple",
  "travel-teal",
  "forest-green",
  "sunset-orange",
  "midnight-dark",
  "minimal-light",
  "custom",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const MODES = ["light", "dark", "system"] as const;
export type Mode = (typeof MODES)[number];

type Base = { hue: number; sat: number; primary: string; accent: string };

/** Builds a light palette from a hue and two brand colours, so every preset keeps the same contrast rules. */
function light({ hue, sat, primary, accent }: Base): Palette {
  return {
    primary,
    accent,
    sidebar: "#ffffff",
    sidebarText: hslToHex(hue, sat * 0.5, 30),
    sidebarActive: mix(primary, "#ffffff", 0.88),
    sidebarActiveText: mix(primary, "#000000", 0.45),
    background: hslToHex(hue, sat, 96),
    surface: "#ffffff",
    border: hslToHex(hue, sat * 0.7, 88),
    button: primary,
    text: hslToHex(hue, Math.min(sat * 1.5, 40), 12),
    muted: hslToHex(hue, sat * 0.5, 36),
  };
}

/** Dark counterpart: deep tinted neutrals, a lighter primary for text/links, the original primary for buttons. */
function dark({ hue, sat, primary, accent }: Base): Palette {
  const lifted = mix(primary, "#ffffff", 0.35);
  const side = hslToHex(hue, Math.min(sat + 4, 30), 10);
  return {
    primary: lifted,
    accent: mix(accent, "#ffffff", 0.2),
    sidebar: side,
    sidebarText: hslToHex(hue, sat * 0.6, 76),
    sidebarActive: mix(side, primary, 0.45),
    sidebarActiveText: "#ffffff",
    background: hslToHex(hue, Math.min(sat + 4, 30), 8),
    surface: hslToHex(hue, Math.min(sat + 2, 28), 13),
    border: hslToHex(hue, sat * 0.8, 24),
    button: primary,
    text: hslToHex(hue, Math.min(sat, 25), 95),
    muted: hslToHex(hue, sat * 0.6, 70),
  };
}

const BLUE: Base = { hue: 222, sat: 22, primary: "#1d4ed8", accent: "#0891b2" };
const PURPLE: Base = { hue: 262, sat: 20, primary: "#6d28d9", accent: "#db2777" };
const TEAL: Base = { hue: 185, sat: 22, primary: "#0f766e", accent: "#d97706" };
const GREEN: Base = { hue: 145, sat: 18, primary: "#166534", accent: "#ca8a04" };
const ORANGE: Base = { hue: 28, sat: 28, primary: "#c2410c", accent: "#be123c" };
const MIDNIGHT: Base = { hue: 235, sat: 26, primary: "#4f46e5", accent: "#06b6d4" };
const MINIMAL: Base = { hue: 220, sat: 4, primary: "#3f3f46", accent: "#71717a" };

export type PresetDef = {
  id: Exclude<PresetId, "custom">;
  name: string;
  blurb: string;
  light: Palette;
  dark: Palette;
};

export const PRESETS: PresetDef[] = [
  {
    id: "professional-blue",
    name: "Professional Blue",
    blurb: "Blue accents, white surfaces, light grey background.",
    light: light(BLUE),
    dark: dark(BLUE),
  },
  {
    id: "modern-purple",
    name: "Modern Purple",
    blurb: "Purple accents with clean neutral surfaces.",
    light: light(PURPLE),
    dark: dark(PURPLE),
  },
  {
    id: "travel-teal",
    name: "Travel Teal",
    blurb: "Teal accents with fresh, calm backgrounds.",
    light: light(TEAL),
    dark: dark(TEAL),
  },
  {
    id: "forest-green",
    name: "Forest Green",
    blurb: "Green accents with neutral surfaces.",
    light: light(GREEN),
    dark: dark(GREEN),
  },
  {
    id: "sunset-orange",
    name: "Sunset Orange",
    blurb: "Orange accents with warm neutral surfaces.",
    light: light(ORANGE),
    dark: dark(ORANGE),
  },
  {
    // always dark: choosing Light mode with this preset still shows the dark palette
    id: "midnight-dark",
    name: "Midnight Dark",
    blurb: "Dark backgrounds with light, readable text.",
    light: dark(MIDNIGHT),
    dark: dark(MIDNIGHT),
  },
  {
    id: "minimal-light",
    name: "Minimal Light",
    blurb: "White surfaces, subtle borders, restrained grey accents.",
    light: light(MINIMAL),
    dark: dark(MINIMAL),
  },
];

export const CUSTOM_NAME = "Custom Theme";
export const CUSTOM_BLURB = "Choose your own primary and accent colours, and adjust the rest.";

export function presetById(id: string): PresetDef | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Starting colours for a new custom theme: Professional Blue (light) and its dark counterpart. */
export const CUSTOM_SEED: { light: Palette; dark: Palette } = {
  light: PRESETS[0].light,
  dark: PRESETS[0].dark,
};
