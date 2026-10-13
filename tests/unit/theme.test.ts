import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, hslToHex, isHex, mix, readableOn } from "@/lib/theme/color";
import { blockingProblems, checkContrast } from "@/lib/theme/contrast";
import { buildThemeCss, paletteVars } from "@/lib/theme/css";
import { COLOR_KEYS, PRESETS, PRESET_IDS } from "@/lib/theme/presets";
import { DEFAULT_THEME, parseTheme, resolvePalettes, themeSchema } from "@/lib/theme/schema";
import { STATIC_TOKENS } from "@/lib/theme/tones";

describe("colour maths", () => {
  it("computes the WCAG contrast ratio", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(contrast("#767676", "#ffffff")).toBeGreaterThan(4.5); // the classic AA boundary grey
  });
  it("picks a readable text colour", () => {
    expect(readableOn("#ffffff")).toBe("#0b0f19");
    expect(readableOn("#0f172a")).toBe("#ffffff");
    for (const bg of ["#1d4ed8", "#f59e0b", "#0f766e", "#808080"]) {
      expect(contrast(bg, readableOn(bg))).toBeGreaterThan(4);
    }
  });
  it("mixes and converts", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(hslToHex(0, 0, 100)).toBe("#ffffff");
    expect(isHex("#1D4ED8")).toBe(true);
    expect(isHex("#12345")).toBe(false);
    expect(isHex("red")).toBe(false);
  });
});

describe("presets", () => {
  it("offers the seven named presets plus custom", () => {
    expect(PRESETS.map((p) => p.name)).toEqual([
      "Professional Blue",
      "Modern Purple",
      "Travel Teal",
      "Forest Green",
      "Sunset Orange",
      "Midnight Dark",
      "Minimal Light",
    ]);
    expect(PRESET_IDS).toHaveLength(8);
    expect(PRESET_IDS).toContain("custom");
  });

  for (const p of PRESETS) {
    for (const variant of ["light", "dark"] as const) {
      it(`${p.name} (${variant}) has all twelve colours and readable text`, () => {
        const pal = p[variant];
        for (const k of COLOR_KEYS) expect(isHex(pal[k]), `${k}=${pal[k]}`).toBe(true);
        const bad = blockingProblems(pal).map((c) => `${c.label} ${c.ratio.toFixed(2)}`);
        expect(bad).toEqual([]);
        // buttons and primary fills get readable text
        const weak = checkContrast(pal)
          .filter((c) => !c.ok && !c.required)
          .map((c) => `${c.label} ${c.ratio.toFixed(2)}`);
        expect(weak).toEqual([]);
      });
    }
  }

  it("Midnight Dark is dark even in light mode", () => {
    const r = buildThemeCss({ preset: "midnight-dark", mode: "light" })!;
    expect(r.lightIsDark).toBe(true);
    expect(r.css).toContain("color-scheme:dark");
  });
});

describe("theme validation and CSS", () => {
  it("accepts the default and a custom theme", () => {
    expect(themeSchema.safeParse(DEFAULT_THEME).success).toBe(true);
    expect(
      parseTheme({ preset: "custom", mode: "system", custom: { light: { primary: "#112233" } } }),
    ).not.toBeNull();
  });

  it("refuses anything that is not a plain hex colour or a known key", () => {
    for (const bad of [
      "red; background:url(x)",
      "#zzz",
      "#12345",
      "</style><script>",
      "rgb(0,0,0)",
      "url(http://x)",
      "#12345678",
    ]) {
      expect(
        parseTheme({ preset: "custom", mode: "light", custom: { light: { primary: bad } } }),
        bad,
      ).toBeNull();
    }
    expect(
      parseTheme({ preset: "custom", mode: "light", custom: { light: { evil: "#112233" } } }),
    ).toBeNull();
    expect(parseTheme({ preset: "nope", mode: "light" })).toBeNull();
    expect(parseTheme({ preset: "custom", mode: "auto" })).toBeNull();
    expect(parseTheme({ preset: "custom", mode: "light", extra: 1 })).toBeNull();
    expect(parseTheme("string")).toBeNull();
  });

  it("returns null (use the shipped stylesheet) for no theme or a broken one", () => {
    expect(buildThemeCss(null)).toBeNull();
    expect(buildThemeCss(undefined)).toBeNull();
    expect(
      buildThemeCss({ preset: "custom", mode: "light", custom: { light: { primary: "red" } } }),
    ).toBeNull();
  });

  it("only ever writes hex colours and the fixed tones into the stylesheet", () => {
    const r = buildThemeCss({
      preset: "custom",
      mode: "system",
      custom: { light: { primary: "#AA3355" }, dark: { primary: "#3355AA" } },
    })!;
    expect(r.css).not.toMatch(/[<>]|url\(|@import|\/\*|expression/i);
    const values = [...r.css.matchAll(/--[a-z0-9-]+:([^;}]+)/g)].map((m) => m[1]);
    const allowed = new Set<string>([
      ...Object.values(STATIC_TOKENS.light),
      ...Object.values(STATIC_TOKENS.dark),
    ]);
    for (const v of values) {
      expect(/^#[0-9a-f]{6}$/.test(v) || /^var\(--[a-z-]+\)$/.test(v) || allowed.has(v), v).toBe(
        true,
      );
    }
    expect(r.css).toContain("--primary:#aa3355");
    expect(r.css).toContain("@media (prefers-color-scheme: dark)");
  });

  it("light mode emits one block, dark mode uses the dark palette", () => {
    const l = buildThemeCss({ preset: "travel-teal", mode: "light" })!;
    const d = buildThemeCss({ preset: "travel-teal", mode: "dark" })!;
    expect(l.css).not.toContain("@media");
    expect(d.css).not.toContain("@media");
    const teal = PRESETS.find((p) => p.id === "travel-teal")!;
    expect(l.css).toContain(`--background:${teal.light.background}`);
    expect(d.css).toContain(`--background:${teal.dark.background}`);
    expect(d.darkIsDark).toBe(true);
  });

  it("maps a button colour and sidebar colours to their own variables", () => {
    const vars = paletteVars({
      ...PRESETS[0].light,
      button: "#b91c1c",
      sidebar: "#fafafa",
      sidebarActive: "#fee2e2",
    });
    expect(vars["--button"]).toBe("#b91c1c");
    expect(vars["--sidebar"]).toBe("#fafafa");
    expect(vars["--sidebar-accent"]).toBe("#fee2e2");
    expect(isHex(vars["--button-foreground"])).toBe(true);
  });

  it("lays custom colours over the seed palette", () => {
    const { light } = resolvePalettes({
      preset: "custom",
      mode: "light",
      custom: { light: { primary: "#AB1234" } },
    });
    expect(light.primary).toBe("#ab1234");
    expect(light.surface).toBe(PRESETS[0].light.surface);
  });

  it("blocks a theme whose text cannot be read", () => {
    const bad = { ...PRESETS[0].light, text: "#e5e7eb", surface: "#ffffff" };
    expect(blockingProblems(bad).length).toBeGreaterThan(0);
  });
});

describe("fixed tones match app/globals.css", () => {
  const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8").replace(
    /\r\n/g,
    "\n",
  );
  const block = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`);
    return css.slice(start, css.indexOf("\n}", start));
  };
  for (const [name, selector] of [
    ["light", ":root"],
    ["dark", ".dark"],
  ] as const) {
    it(`${name} values are the same as ${selector}`, () => {
      const b = block(selector);
      for (const [k, v] of Object.entries(STATIC_TOKENS[name])) {
        const m = b.match(new RegExp(`${k}:\\s*([^;]+);`));
        expect(m?.[1].trim(), k).toBe(v);
      }
    });
  }
});
