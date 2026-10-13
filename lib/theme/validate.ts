import { blockingProblems } from "@/lib/theme/contrast";
import { resolvePalettes, themeSchema, type Theme } from "@/lib/theme/schema";

export type ThemeCheck = { ok: true; theme: Theme } | { ok: false; message: string };

/**
 * Server-side check for a theme sent from the browser: right shape, only hex colours, and readable text in every
 * palette the chosen mode can show. The editor shows the same messages before Apply, but this is the real gate.
 */
export function checkThemeInput(raw: unknown): ThemeCheck {
  const parsed = themeSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "That theme is not valid. Pick colours like #1d4ed8." };
  const theme = parsed.data;
  const { light, dark } = resolvePalettes(theme);
  const shown =
    theme.mode === "light"
      ? [["light", light]]
      : theme.mode === "dark"
        ? [["dark", dark]]
        : [
            ["light", light],
            ["dark", dark],
          ];
  for (const [variant, palette] of shown as ["light" | "dark", typeof light][]) {
    const bad = blockingProblems(palette);
    if (bad.length) {
      const first = bad[0];
      return {
        ok: false,
        message: `${first.label} is hard to read in the ${variant} colours (contrast ${first.ratio.toFixed(1)}, needs ${first.min}). Choose colours that differ more.`,
      };
    }
  }
  return { ok: true, theme };
}
