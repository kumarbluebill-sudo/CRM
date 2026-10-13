/**
 * Colours that do not come from a theme: status tones, destructive red and the extra chart colours. They are the same
 * values as app/globals.css (:root and .dark); tests/unit/theme.test.ts fails if the two ever drift apart.
 */
export const STATIC_TOKENS = {
  light: {
    "--destructive": "oklch(0.5 0.17 25)",
    "--chart-3": "oklch(0.75 0.14 75)",
    "--chart-4": "oklch(0.64 0.16 25)",
    "--chart-5": "oklch(0.6 0.14 300)",
    "--tone-info": "oklch(0.45 0.11 230)",
    "--tone-info-soft": "oklch(0.95 0.035 225)",
    "--tone-violet": "oklch(0.45 0.13 300)",
    "--tone-violet-soft": "oklch(0.95 0.035 300)",
    "--tone-warn": "oklch(0.48 0.11 65)",
    "--tone-warn-soft": "oklch(0.95 0.05 80)",
    "--tone-ok": "oklch(0.45 0.12 150)",
    "--tone-ok-soft": "oklch(0.95 0.04 150)",
    "--tone-bad": "oklch(0.5 0.17 25)",
    "--tone-bad-soft": "oklch(0.95 0.035 25)",
  },
  dark: {
    "--destructive": "oklch(0.72 0.15 25)",
    "--chart-3": "oklch(0.8 0.13 75)",
    "--chart-4": "oklch(0.72 0.15 25)",
    "--chart-5": "oklch(0.7 0.13 300)",
    "--tone-info": "oklch(0.85 0.08 225)",
    "--tone-info-soft": "oklch(0.3 0.05 225)",
    "--tone-violet": "oklch(0.85 0.09 300)",
    "--tone-violet-soft": "oklch(0.3 0.06 300)",
    "--tone-warn": "oklch(0.87 0.1 80)",
    "--tone-warn-soft": "oklch(0.32 0.05 75)",
    "--tone-ok": "oklch(0.85 0.1 150)",
    "--tone-ok-soft": "oklch(0.3 0.05 150)",
    "--tone-bad": "oklch(0.82 0.1 25)",
    "--tone-bad-soft": "oklch(0.3 0.06 25)",
  },
} as const;
