import { z } from "zod";
import { HEX } from "@/lib/theme/color";
import {
  COLOR_KEYS,
  CUSTOM_SEED,
  MODES,
  PRESET_IDS,
  presetById,
  type ColorKey,
  type Mode,
  type Palette,
  type PresetId,
} from "@/lib/theme/presets";

const hex = z.string().regex(HEX, "Enter a colour like #1d4ed8");

/** A palette where any colour may be left out. Unknown keys are refused. */
const partialPalette = z
  .object(
    Object.fromEntries(COLOR_KEYS.map((k) => [k, hex.optional()])) as Record<
      ColorKey,
      z.ZodOptional<typeof hex>
    >,
  )
  .strict();

export const themeSchema = z
  .object({
    preset: z.enum(PRESET_IDS),
    mode: z.enum(MODES),
    custom: z
      .object({ light: partialPalette.optional(), dark: partialPalette.optional() })
      .strict()
      .optional(),
  })
  .strict();

export type Theme = z.infer<typeof themeSchema>;

export const DEFAULT_THEME: Theme = { preset: "professional-blue", mode: "light" };

/** Returns a valid theme or null (callers then use the stylesheet that ships with the app). */
export function parseTheme(raw: unknown): Theme | null {
  if (raw == null) return null;
  const r = themeSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Both palettes for a theme, with any custom colours laid over the seed. */
export function resolvePalettes(theme: Theme): { light: Palette; dark: Palette } {
  if (theme.preset !== "custom") {
    const p = presetById(theme.preset) ?? presetById("professional-blue")!;
    return { light: p.light, dark: p.dark };
  }
  const merge = (seed: Palette, over?: Partial<Record<ColorKey, string | undefined>>): Palette => {
    const out = { ...seed };
    for (const k of COLOR_KEYS) {
      const v = over?.[k];
      if (v && HEX.test(v)) out[k] = v.toLowerCase();
    }
    return out;
  };
  return {
    light: merge(CUSTOM_SEED.light, theme.custom?.light),
    dark: merge(CUSTOM_SEED.dark, theme.custom?.dark),
  };
}

export type { Mode, PresetId };
