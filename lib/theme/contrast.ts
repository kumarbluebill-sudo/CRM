import { contrast, readableOn } from "@/lib/theme/color";
import type { ColorKey, Palette } from "@/lib/theme/presets";
import { COLOR_LABELS } from "@/lib/theme/presets";

export type ContrastCheck = {
  /** Plain-language name of the pair, for the message shown to the user. */
  label: string;
  fg: ColorKey;
  bg: ColorKey;
  ratio: number;
  min: number;
  /** A failed required pair stops the theme being applied; an advisory pair only warns. */
  required: boolean;
  ok: boolean;
};

const PAIRS: { label: string; fg: ColorKey; bg: ColorKey; min: number; required: boolean }[] = [
  { label: "Text on cards", fg: "text", bg: "surface", min: 4.5, required: true },
  { label: "Text on the page background", fg: "text", bg: "background", min: 4.5, required: true },
  { label: "Muted text on cards", fg: "muted", bg: "surface", min: 4.5, required: true },
  {
    label: "Muted text on the page background",
    fg: "muted",
    bg: "background",
    min: 4.5,
    required: true,
  },
  { label: "Sidebar text", fg: "sidebarText", bg: "sidebar", min: 4.5, required: true },
  {
    label: "Active menu text",
    fg: "sidebarActiveText",
    bg: "sidebarActive",
    min: 4.5,
    required: true,
  },
  { label: "Primary colour on cards", fg: "primary", bg: "surface", min: 3, required: false },
  {
    label: "Sidebar text on the active menu background",
    fg: "sidebarText",
    bg: "sidebarActive",
    min: 3,
    required: false,
  },
];

export function checkContrast(p: Palette): ContrastCheck[] {
  const checks: ContrastCheck[] = PAIRS.map((x) => {
    const ratio = contrast(p[x.fg], p[x.bg]);
    return { ...x, ratio, ok: ratio >= x.min };
  });
  // buttons and primary-coloured fills get their text colour picked automatically; warn when even that is weak
  for (const key of ["button", "primary"] as const) {
    const ratio = contrast(p[key], readableOn(p[key]));
    checks.push({
      label: `Text on ${COLOR_LABELS[key].toLowerCase()}`,
      fg: key,
      bg: key,
      ratio,
      min: 4.5,
      required: false,
      ok: ratio >= 4.5,
    });
  }
  return checks;
}

export const blockingProblems = (p: Palette) => checkContrast(p).filter((c) => c.required && !c.ok);
