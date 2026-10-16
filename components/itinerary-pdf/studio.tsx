"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Download, Eye, Loader2, MessageCircle, Pencil, Save } from "lucide-react";
import { toast } from "sonner";
import { ItineraryPreview, SHEET_H, SHEET_W } from "@/components/itinerary-pdf/preview";
import { Button } from "@/components/ui/button";
import { buildItineraryPdfModel, pickQuote, type PdfSource } from "@/lib/itinerary-pdf/model";
import {
  PDF_SECTION_KEYS,
  PDF_SECTION_LABELS,
  PDF_THEMES,
  type PdfSectionKey,
  type PdfSettings,
} from "@/lib/itinerary-pdf/themes";
import { saveItineraryPdfSettingsAction } from "@/app/(app)/itineraries/[id]/package/pdf-actions";

type QuotationChoice = {
  id: string;
  number: string;
  title: string;
  currency: string;
  selectedOptionId: string | null;
  options: { id: string; name: string; total: number }[];
};

const field =
  "border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-11 w-full rounded-lg border px-3 text-base outline-none focus-visible:ring-3 lg:h-9 lg:text-sm";
const GAP = 24;

export function PdfStudio({
  id,
  source,
  initial,
  quotations,
  images,
  canEdit,
  canStore,
}: {
  id: string;
  source: PdfSource;
  initial: PdfSettings;
  quotations: QuotationChoice[];
  images: { id: string; name: string }[];
  canEdit: boolean;
  canStore: boolean;
}) {
  const [settings, setSettings] = useState<PdfSettings>(initial);
  const [saved, setSaved] = useState<PdfSettings>(initial);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"save" | "download" | "share" | null>(null);
  const [link, setLink] = useState<{ url: string; whatsappUrl: string | null } | null>(null);

  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const model = useMemo(() => buildItineraryPdfModel(source, settings), [source, settings]);
  const picked = pickQuote(source.quotations, settings);
  const activeQuote = quotations.find((q) => q.id === picked?.quotation.id) ?? null;

  const set = (patch: Partial<PdfSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const toggle = (k: PdfSectionKey) =>
    setSettings((s) => ({ ...s, sections: { ...s.sections, [k]: !s.sections[k] } }));

  async function save(): Promise<boolean> {
    if (!canEdit) return true;
    setBusy("save");
    const res = await saveItineraryPdfSettingsAction(id, settings);
    setBusy(null);
    if (res.ok) {
      setSaved(settings);
      return true;
    }
    toast.error(res.message ?? "Could not save the PDF settings.");
    return false;
  }

  const onSave = () =>
    start(async () => {
      if (await save()) toast.success("PDF settings saved.");
    });

  const onDownload = () =>
    start(async () => {
      if (dirty && !(await save())) return;
      setBusy("download");
      const q = new URLSearchParams();
      if (settings.quotationId) q.set("quotation", settings.quotationId);
      if (settings.optionId) q.set("option", settings.optionId);
      window.open(`/api/itineraries/${id}/itinerary-pdf${q.size ? `?${q}` : ""}`, "_blank", "noopener");
      setBusy(null);
    });

  const onShare = () =>
    start(async () => {
      if (dirty && !(await save())) return;
      setBusy("share");
      try {
        const res = await fetch(`/api/itineraries/${id}/itinerary-pdf`, { method: "POST" });
        const body = (await res.json().catch(() => ({}))) as { url?: string; whatsappUrl?: string | null; error?: string };
        if (!res.ok || !body.url) {
          toast.error(body.error ?? "Could not create the share link.");
          return;
        }
        setLink({ url: body.url, whatsappUrl: body.whatsappUrl ?? null });
        toast.success("PDF saved to Documents. The link works for 7 days.");
        if (body.whatsappUrl) window.open(body.whatsappUrl, "_blank", "noopener");
      } finally {
        setBusy(null);
      }
    });

  // scale the A4 sheets to the width of the panel
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.7);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, Math.max(0.2, el.clientWidth / SHEET_W)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  const sheets = model.pages.length;

  const controls = (
    <div className="flex flex-col gap-5" data-testid="pdf-controls">
      {quotations.length > 0 ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Quotation
            <select
              className={field}
              value={picked?.quotation.id ?? ""}
              onChange={(e) => {
                const q = quotations.find((x) => x.id === e.target.value);
                set({ quotationId: e.target.value, optionId: q?.selectedOptionId ?? q?.options[0]?.id ?? null });
              }}
            >
              {quotations.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.number}
                  {q.title ? ` · ${q.title}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Price option
            <select
              className={field}
              value={picked?.option.id ?? ""}
              onChange={(e) => set({ optionId: e.target.value })}
            >
              {(activeQuote?.options ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.id === activeQuote?.selectedOptionId ? " (selected)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <p className="bg-muted text-muted-foreground rounded-lg p-3 text-sm">
          No quotation is linked to this itinerary yet, so the price page is left out. Create a quotation from this itinerary
          and it will appear here.
        </p>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Theme</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {PDF_THEMES.map((t) => (
            <label
              key={t.key}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm ${settings.theme === t.key ? "border-primary ring-primary/30 ring-2" : ""}`}
            >
              <input
                type="radio"
                name="pdf-theme"
                className="sr-only"
                checked={settings.theme === t.key}
                onChange={() => set({ theme: t.key })}
              />
              <span className="flex shrink-0 overflow-hidden rounded" aria-hidden>
                <span className="size-5" style={{ background: t.primary }} />
                <span className="size-5" style={{ background: t.accent }} />
                <span className="size-5" style={{ background: t.tint }} />
              </span>
              <span className="font-medium">{t.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Cover photo</legend>
        {images.length === 0 ? (
          <p className="text-muted-foreground text-sm">Add photos in the Photos tab to choose a cover.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <label className={`flex min-h-16 cursor-pointer items-center justify-center rounded-lg border p-1 text-center text-xs ${settings.coverImageId === null ? "border-primary ring-primary/30 ring-2" : ""}`}>
              <input type="radio" name="pdf-cover" className="sr-only" checked={settings.coverImageId === null} onChange={() => set({ coverImageId: null })} />
              Automatic
            </label>
            {images.map((im) => (
              <label key={im.id} className={`relative cursor-pointer overflow-hidden rounded-lg border ${settings.coverImageId === im.id ? "border-primary ring-primary/30 ring-2" : ""}`}>
                <input type="radio" name="pdf-cover" className="sr-only" checked={settings.coverImageId === im.id} onChange={() => set({ coverImageId: im.id })} aria-label={`Cover photo ${im.name}`} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/package-images/${im.id}`} alt={im.name} loading="lazy" className="h-16 w-full object-cover" />
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Sections</legend>
        {PDF_SECTION_KEYS.map((k) => (
          <label key={k} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm lg:min-h-9">
            <input type="checkbox" className="size-5 lg:size-4" checked={settings.sections[k]} onChange={() => toggle(k)} />
            {PDF_SECTION_LABELS[k]}
          </label>
        ))}
      </fieldset>

      <div className="hidden flex-col gap-2 lg:flex">
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button variant="outline" onClick={onSave} loading={busy === "save"} disabled={!dirty || pending}>
              <Save /> Save settings
            </Button>
          )}
          <Button onClick={onDownload} loading={busy === "download"} disabled={pending}>
            <Download /> Download PDF
          </Button>
        </div>
      </div>
      {canStore && (
        <Button variant="outline" className="h-11 text-base lg:h-9 lg:text-sm" onClick={onShare} loading={busy === "share"} disabled={pending}>
          <MessageCircle /> Share on WhatsApp
        </Button>
      )}
      {link && (
        <p className="bg-muted rounded-lg p-3 text-sm break-all" role="status">
          Link (valid 7 days):{" "}
          <a href={link.url} className="text-primary underline" target="_blank" rel="noopener noreferrer">
            open PDF
          </a>
          {!link.whatsappUrl && " · This customer has no WhatsApp or phone number saved."}
        </p>
      )}
    </div>
  );

  const preview = (
    <div ref={wrap} className="w-full min-w-0 overflow-hidden" data-testid="pdf-preview">
      <div style={{ height: (sheets * (SHEET_H + GAP) - GAP) * scale }} className="relative">
        <div style={{ width: SHEET_W, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <ItineraryPreview model={model} imageUrl={(i) => `/api/package-images/${i}`} />
        </div>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">
        {sheets} page{sheets === 1 ? "" : "s"}. The preview is close to the PDF; very long text can continue onto an extra page in the file.
      </p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 pb-24 lg:pb-0">
      {/* phones and tablets: Edit / Preview switch */}
      <div role="tablist" aria-label="Studio view" className="flex gap-1 overflow-x-auto border-b lg:hidden">
        {(["edit", "preview"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-base ${view === v ? "border-primary font-medium" : "text-muted-foreground border-transparent"}`}
          >
            {v === "edit" ? "Edit" : "Preview"}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className={`min-w-0 ${view === "edit" ? "block" : "hidden lg:block"}`}>{controls}</div>
        <div className={`min-w-0 ${view === "preview" ? "block" : "hidden lg:block"}`}>{preview}</div>
      </div>

      {/* phones: sticky bottom bar */}
      <div
        className="bg-background fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t p-3 lg:hidden"
        data-testid="pdf-mobile-bar"
      >
        <Button variant="outline" className="h-11 flex-1 text-base" onClick={() => setView(view === "edit" ? "preview" : "edit")}>
          {view === "edit" ? <Eye /> : <Pencil />} {view === "edit" ? "Preview" : "Edit"}
        </Button>
        {canEdit && (
          <Button variant="outline" className="h-11 flex-1 text-base" onClick={onSave} loading={busy === "save"} disabled={!dirty || pending}>
            <Save /> Save
          </Button>
        )}
        <Button className="h-11 flex-[1.4] text-base" onClick={onDownload} loading={busy === "download"} disabled={pending}>
          {pending && busy === null ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
        </Button>
      </div>
    </div>
  );
}
