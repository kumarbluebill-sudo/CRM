"use client";

import { useLayoutEffect } from "react";
import type { Mode } from "@/lib/theme/presets";

/**
 * The colours come from the server-rendered stylesheet. This only keeps the `dark` class on <html> in step with the
 * chosen palette, because Tailwind's `dark:` utilities look for that class. In System mode it follows the device.
 */
export function ThemeApplier({
  mode,
  lightIsDark,
  darkIsDark,
}: {
  mode: Mode;
  lightIsDark: boolean;
  darkIsDark: boolean;
}) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark =
        mode === "light"
          ? lightIsDark
          : mode === "dark"
            ? darkIsDark
            : media.matches
              ? darkIsDark
              : lightIsDark;
      root.classList.toggle("dark", dark);
    };
    apply();
    if (mode !== "system") return () => root.classList.remove("dark");
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      root.classList.remove("dark");
    };
  }, [mode, lightIsDark, darkIsDark]);
  return null;
}
