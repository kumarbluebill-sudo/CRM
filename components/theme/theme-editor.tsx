"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { PresetThumb, ThemePreview } from "@/components/theme/theme-preview";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/schemas";
import { isHex } from "@/lib/theme/color";
import { checkContrast } from "@/lib/theme/contrast";
import {
  COLOR_LABELS,
  CUSTOM_BLURB,
  CUSTOM_NAME,
  PRESETS,
  type ColorKey,
  type Mode,
  type Palette,
  type PresetId,
} from "@/lib/theme/presets";
import { DEFAULT_THEME, resolvePalettes, type Theme } from "@/lib/theme/schema";
import { cn } from "@/lib/utils";

type Props = {
  scope: "org" | "user";
  /** What is saved at this level now (null = nothing saved). */
  saved: Theme | null;
  /** The agency default, shown as the starting point for a person's own theme. */
  agency: Theme | null;
  apply: (theme: Theme | null) => Promise<FormState>;
};

const GROUPS: { title: string; keys: ColorKey[] }[] = [
  { title: "Brand", keys: ["primary", "accent", "button"] },
  { title: "Sidebar", keys: ["sidebar", "sidebarText", "sidebarActive", "sidebarActiveText"] },
  { title: "Page", keys: ["background", "surface", "border"] },
  { title: "Text", keys: ["text", "muted"] },
];

const MODE_LABELS: Record<Mode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System default",
};

export function ThemeEditor({ scope, saved, agency, apply }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const baseline = saved ?? agency ?? DEFAULT_THEME;
  const [follow, setFollow] = useState(scope === "user" && saved === null);
  const [draft, setDraft] = useState<Theme>(baseline);
  const [editing, setEditing] = useState<"light" | "dark">(
    baseline.mode === "dark" ? "dark" : "light",
  );
  const id = useId();

  const palettes = useMemo(() => resolvePalettes(draft), [draft]);
  const shown: ("light" | "dark")[] =
    draft.mode === "light" ? ["light"] : draft.mode === "dark" ? ["dark"] : ["light", "dark"];
  const checks = shown.flatMap((v) =>
    checkContrast(palettes[v]).map((c) => ({ ...c, variant: v })),
  );
  const problems = checks.filter((c) => !c.ok);
  const blocking = problems.filter((c) => c.required);

  const dirty =
    (scope === "user" && follow !== (saved === null)) ||
    (!follow && JSON.stringify(draft) !== JSON.stringify(baseline));
  const canApply = !pending && (follow ? dirty : dirty && blocking.length === 0);

  /** Any edit to a preset turns it into a custom theme that starts from that preset's colours. */
  const toCustom = (t: Theme): Theme =>
    t.preset === "custom"
      ? t
      : {
          ...t,
          preset: "custom",
          custom: { light: { ...palettes.light }, dark: { ...palettes.dark } },
        };

  function pickPreset(p: PresetId) {
    setFollow(false);
    setDraft((d) => {
      if (p !== "custom") return { preset: p, mode: d.mode };
      return toCustom(d);
    });
  }
  function setMode(mode: Mode) {
    setFollow(false);
    setDraft((d) => ({ ...d, mode }));
    setEditing(mode === "dark" ? "dark" : "light");
  }
  function setColor(key: ColorKey, value: string) {
    setFollow(false);
    setDraft((d) => {
      const c = toCustom(d);
      return {
        ...c,
        custom: { ...c.custom, [editing]: { ...c.custom?.[editing], [key]: value.toLowerCase() } },
      };
    });
  }

  function run(theme: Theme | null, after?: () => void) {
    start(async () => {
      const res = await apply(theme);
      if (res.ok) {
        toast.success(res.message ?? "Theme applied.");
        after?.();
        router.refresh();
      } else {
        toast.error(res.message ?? "Could not save the theme.");
      }
    });
  }

  function cancel() {
    setFollow(scope === "user" && saved === null);
    setDraft(baseline);
    setEditing(baseline.mode === "dark" ? "dark" : "light");
  }

  function reset() {
    run(null, () => {
      setFollow(scope === "user");
      setDraft(scope === "user" ? (agency ?? DEFAULT_THEME) : DEFAULT_THEME);
      setEditing("light");
    });
  }

  const activeId: PresetId | null = follow ? null : draft.preset;
  const previewPalette: Palette = (follow && agency ? resolvePalettes(agency) : palettes)[editing];

  return (
    <div className="flex flex-col gap-6">
      {scope === "user" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Whose theme do you want?</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-follow`}
              checked={follow}
              onChange={() => setFollow(true)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Follow my agency&apos;s theme</span>
              <span className="text-muted-foreground block">
                {agency
                  ? "Your agency has chosen a theme. You will see it."
                  : "Your agency has not chosen a theme, so you see the standard look."}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-follow`}
              checked={!follow}
              onChange={() => setFollow(false)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Use my own theme</span>
              <span className="text-muted-foreground block">
                Only you see this. Other people keep the agency theme.
              </span>
            </span>
          </label>
        </fieldset>
      )}

      <div
        className={cn("flex flex-col gap-6", follow && "pointer-events-none opacity-50")}
        aria-disabled={follow}
      >
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Theme</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[
              ...PRESETS.map((p) => ({
                id: p.id as PresetId,
                name: p.name,
                blurb: p.blurb,
                pal: p[draft.mode === "dark" ? "dark" : "light"],
              })),
              {
                id: "custom" as PresetId,
                name: CUSTOM_NAME,
                blurb: CUSTOM_BLURB,
                pal: palettes[draft.mode === "dark" ? "dark" : "light"],
              },
            ].map((p) => (
              <label key={p.id} className="relative block cursor-pointer">
                <input
                  type="radio"
                  name={`${id}-preset`}
                  value={p.id}
                  checked={activeId === p.id}
                  onChange={() => pickPreset(p.id)}
                  disabled={follow}
                  className="peer sr-only"
                />
                <span className="bg-card peer-checked:ring-primary peer-focus-visible:ring-ring flex flex-col gap-2 rounded-xl border p-2.5 transition-shadow peer-checked:ring-2 peer-focus-visible:ring-2 motion-reduce:transition-none">
                  <PresetThumb palette={p.pal} />
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-muted-foreground text-xs">{p.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Mode</legend>
          <div className="flex flex-wrap gap-4">
            {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${id}-mode`}
                  checked={draft.mode === m}
                  onChange={() => setMode(m)}
                  disabled={follow}
                />
                {MODE_LABELS[m]}
              </label>
            ))}
          </div>
          {draft.preset === "midnight-dark" && (
            <p className="text-muted-foreground mt-1 text-xs">
              Midnight Dark is always dark, whichever mode you pick.
            </p>
          )}
        </fieldset>

        <section aria-labelledby={`${id}-colours`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={`${id}-colours`} className="text-sm font-medium">
              Colours
            </h2>
            <div
              role="group"
              aria-label="Which colours to edit and preview"
              className="bg-muted inline-flex rounded-lg p-[3px]"
            >
              {(["light", "dark"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={editing === v}
                  onClick={() => setEditing(v)}
                  disabled={follow}
                  className={cn(
                    "focus-visible:ring-ring rounded-md px-3 py-1 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none",
                    editing === v ? "bg-card text-foreground shadow-xs" : "text-muted-foreground",
                  )}
                >
                  {v === "light" ? "Light colours" : "Dark colours"}
                </button>
              ))}
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Changing any colour turns the theme into your own Custom Theme, starting from the
            colours shown. Light and dark have their own colours.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {GROUPS.map((g) => (
              <div key={g.title} className="flex flex-col gap-2 rounded-lg border p-3">
                <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  {g.title}
                </h3>
                {g.keys.map((k) => (
                  <ColorField
                    key={`${editing}-${k}`}
                    label={COLOR_LABELS[k]}
                    value={palettes[editing][k]}
                    disabled={follow}
                    onChange={(v) => setColor(k, v)}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>

        <section aria-live="polite" className="flex flex-col gap-1 text-sm">
          {problems.length === 0 ? (
            <p className="text-tone-ok flex items-center gap-1.5">
              <CheckCircle2 className="size-4" aria-hidden /> Text is easy to read in these colours.
            </p>
          ) : (
            problems.map((c) => (
              <p
                key={`${c.variant}-${c.label}`}
                className={cn(
                  "flex items-start gap-1.5",
                  c.required ? "text-tone-bad" : "text-tone-warn",
                )}
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {c.label} ({c.variant} colours): contrast {c.ratio.toFixed(1)}, aim for {c.min}.{" "}
                  {c.required ? "Fix this before applying." : "You can still apply."}
                </span>
              </p>
            ))
          )}
        </section>
      </div>

      <section aria-labelledby={`${id}-preview`} className="flex flex-col gap-2">
        <h2 id={`${id}-preview`} className="text-sm font-medium">
          Preview
        </h2>
        <ThemePreview
          palette={previewPalette}
          label={`Preview of the ${editing} colours: sidebar, button, card, chart and accent`}
        />
        <p className="text-muted-foreground text-xs">
          The preview shows your choices only. The rest of the app does not change until you choose
          Apply theme.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => run(follow ? null : draft)} disabled={!canApply}>
          {pending ? "Applying…" : "Apply theme"}
        </Button>
        <Button type="button" variant="outline" onClick={cancel} disabled={pending || !dirty}>
          Cancel
        </Button>
        <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
          {scope === "user" ? "Reset to agency default" : "Reset to default"}
        </Button>
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  const bad = !isHex(text);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={`${label}: colour picker`}
        value={isHex(value) ? value : "#000000"}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
        className="border-input size-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
      />
      <label className="flex min-w-0 flex-1 flex-col text-xs">
        <span className="text-foreground">{label}</span>
        <input
          type="text"
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          aria-label={`${label}: hex value`}
          aria-invalid={bad || undefined}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            setText(v);
            if (isHex(v)) onChange(v);
          }}
          onBlur={() => setText(isHex(text) ? text.toLowerCase() : value)}
          className={cn(
            "border-input bg-background mt-0.5 h-7 w-full rounded-md border px-2 font-mono text-xs",
            bad && "border-destructive",
          )}
        />
      </label>
    </div>
  );
}
