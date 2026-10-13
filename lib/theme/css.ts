import { contrast, isDarkColor, isHex, mix, readableOn } from "@/lib/theme/color";
import type { Palette } from "@/lib/theme/presets";
import { parseTheme, resolvePalettes, type Mode } from "@/lib/theme/schema";
import { STATIC_TOKENS } from "@/lib/theme/tones";

/** `preferred` if it reads well on `bg`, otherwise plain black or white. */
const pickText = (bg: string, preferred: string) =>
  contrast(bg, preferred) >= 4.5 ? preferred : readableOn(bg);

/** Every CSS variable for one palette. Values are validated "#rrggbb" strings or the fixed tones, never user text. */
export function paletteVars(p: Palette): Record<string, string> {
  const dark = isDarkColor(p.background);
  const secondary = mix(p.surface, p.primary, dark ? 0.22 : 0.1);
  const accentSurface = mix(p.surface, p.accent, dark ? 0.28 : 0.14);
  const toneSoft = mix(p.surface, p.primary, dark ? 0.25 : 0.1);
  const muted = mix(p.surface, p.text, 0.06);
  const base = dark ? STATIC_TOKENS.dark : STATIC_TOKENS.light;
  const onPrimary = readableOn(p.primary);

  return {
    "--background": p.background,
    "--foreground": p.text,
    "--card": p.surface,
    "--card-foreground": p.text,
    "--popover": p.surface,
    "--popover-foreground": p.text,
    "--primary": p.primary,
    "--primary-foreground": onPrimary,
    "--secondary": secondary,
    "--secondary-foreground": pickText(
      secondary,
      dark ? mix(p.primary, "#ffffff", 0.7) : mix(p.primary, "#000000", 0.4),
    ),
    "--muted": muted,
    "--muted-foreground": p.muted,
    "--accent": accentSurface,
    "--accent-foreground": pickText(
      accentSurface,
      dark ? mix(p.accent, "#ffffff", 0.7) : mix(p.accent, "#000000", 0.55),
    ),
    "--border": p.border,
    "--input": mix(p.border, p.text, 0.12),
    "--button": p.button,
    "--button-foreground": readableOn(p.button),
    "--chart-1": p.primary,
    "--chart-2": p.accent,
    "--sidebar": p.sidebar,
    "--sidebar-foreground": p.sidebarText,
    "--sidebar-primary": p.primary,
    "--sidebar-primary-foreground": onPrimary,
    "--sidebar-accent": p.sidebarActive,
    "--sidebar-accent-foreground": p.sidebarActiveText,
    "--sidebar-border": p.border,
    "--tone-neutral": p.muted,
    "--tone-neutral-soft": muted,
    "--tone-primary-soft": toneSoft,
    "--tone-primary": pickText(
      toneSoft,
      dark ? mix(p.primary, "#ffffff", 0.7) : mix(p.primary, "#000000", 0.4),
    ),
    ...base,
  };
}

const block = (vars: Record<string, string>, scheme: "light" | "dark") =>
  `html:root{color-scheme:${scheme};${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}`;

export type ThemeRender = {
  css: string;
  mode: Mode;
  /** Whether the light / dark palette is a dark one, so the page can add the `dark` class for Tailwind's dark: utilities. */
  lightIsDark: boolean;
  darkIsDark: boolean;
};

/**
 * Turns a saved theme into a stylesheet. Anything that is not a valid theme returns null, which means "use the
 * stylesheet that ships with the app". Colours are re-validated here, so a bad value in the database cannot reach CSS.
 */
export function buildThemeCss(raw: unknown): ThemeRender | null {
  const theme = parseTheme(raw);
  if (!theme) return null;
  const { light, dark } = resolvePalettes(theme);
  const palettes = [light, dark];
  if (!palettes.every((p) => Object.values(p).every(isHex))) return null;

  const lightVars = paletteVars(light);
  const darkVars = paletteVars(dark);
  const lightIsDark = isDarkColor(light.background);
  const darkIsDark = isDarkColor(dark.background);

  let css: string;
  if (theme.mode === "light") css = block(lightVars, lightIsDark ? "dark" : "light");
  else if (theme.mode === "dark") css = block(darkVars, darkIsDark ? "dark" : "light");
  else
    css = `${block(lightVars, lightIsDark ? "dark" : "light")}@media (prefers-color-scheme: dark){${block(darkVars, darkIsDark ? "dark" : "light")}}`;
  return { css, mode: theme.mode, lightIsDark, darkIsDark };
}

/** The same variables as an inline style object, for the scoped preview panel (never the whole page). */
export function previewStyle(p: Palette): React.CSSProperties {
  return paletteVars(p) as React.CSSProperties;
}
