"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Calculator, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveQuotationAction } from "@/app/(app)/quotations/actions";
import { label } from "@/lib/crm/constants";
import { computeOption, computeProfit, formatMoney, priceFromCost } from "@/lib/quotation/pricing";
import {
  fromEditor,
  ITEM_TYPES,
  MAX_ITEMS,
  MAX_OPTIONS,
  newEditorItem,
  newEditorOption,
  toEditor,
  type EditorItem,
  type EditorOption,
  type EditorQuotation,
} from "@/lib/quotation/schema";

type Props = {
  id: string;
  initial: Record<string, unknown>;
  canEdit: boolean;
  /** Server decided: this user may see and edit supplier costs. */
  canSeeCost: boolean;
  canSeeProfit: boolean;
  currency: string;
};

const num = (v: string) => (v === "" || Number.isNaN(Number(v)) ? 0 : Number(v));
const OPTION_NAMES = [
  "Option A – Standard",
  "Option B – Premium",
  "Option C – Luxury",
  "Option D",
  "Option E",
];

export function QuotationBuilder({
  id,
  initial,
  canEdit,
  canSeeCost,
  canSeeProfit,
  currency,
}: Props) {
  const [q, setQ] = useState<EditorQuotation>(() => toEditor(initial));
  const [version, setVersion] = useState(Number(initial.version ?? 1));
  const [active, setActive] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const ro = !canEdit;
  const option = q.options[Math.min(active, q.options.length - 1)];

  const edit = (fn: (d: EditorQuotation) => EditorQuotation) => {
    setQ(fn);
    setDirty(true);
  };
  const setField = <K extends keyof EditorQuotation>(k: K, v: EditorQuotation[K]) =>
    edit((d) => ({ ...d, [k]: v }));
  const setOption = (oi: number, patch: Partial<EditorOption>) =>
    edit((d) => ({ ...d, options: d.options.map((o, i) => (i === oi ? { ...o, ...patch } : o)) }));
  const setItem = (oi: number, ii: number, patch: Partial<EditorItem>) =>
    edit((d) => ({
      ...d,
      options: d.options.map((o, i) =>
        i === oi
          ? { ...o, items: o.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) }
          : o,
      ),
    }));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Live preview; the database recomputes authoritative totals on save.
  const totals = useMemo(
    () =>
      q.options.map((o) => {
        const lines = o.items.map((i) => ({
          quantity: num(i.quantity),
          unitPrice: num(i.unitPrice),
          unitCost: canSeeCost && i.unitCost !== "" ? num(i.unitCost) : null,
        }));
        const t = computeOption(lines, o.discountType, num(o.discountValue), num(o.taxRate));
        return { t, profit: canSeeProfit ? computeProfit(lines, t) : null };
      }),
    [q.options, canSeeCost, canSeeProfit],
  );

  function save(opts: { snapshot?: boolean; label?: string } = {}) {
    start(async () => {
      const res = await saveQuotationAction(id, version, fromEditor(q, canSeeCost), opts);
      if (res.ok && res.version) {
        setVersion(res.version);
        setDirty(false);
        setProblems([]);
        toast.success(opts.snapshot ? "Version saved" : "Saved");
      } else {
        setProblems(res.problems ?? []);
        toast.error(res.message ?? "Could not save.");
      }
    });
  }

  const money = (n: number) => formatMoney(n, currency);
  const t = totals[Math.min(active, totals.length - 1)];

  return (
    <div className="flex flex-col gap-5">
      {!ro && (
        <div className="bg-card sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border p-3">
          <span className="text-sm font-medium">
            v{version}
            {dirty && <span className="text-amber-600"> · unsaved changes</span>}
          </span>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => save({ snapshot: true, label: "Manual snapshot" })}
          >
            Save version
          </Button>
          <Button size="sm" disabled={pending || !dirty} onClick={() => save()}>
            <Save className="size-4" aria-hidden /> Save
          </Button>
        </div>
      )}

      {problems.length > 0 && (
        <ul
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive list-disc rounded-lg border p-3 pl-7 text-sm"
        >
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <section className="bg-card grid gap-4 rounded-xl border p-5 sm:grid-cols-2">
        <Field label="Title" wide>
          <Input
            disabled={ro}
            value={q.title}
            onChange={(e) => setField("title", e.target.value)}
          />
        </Field>
        <Field label="Valid until">
          <Input
            disabled={ro}
            type="date"
            value={q.validUntil}
            onChange={(e) => setField("validUntil", e.target.value)}
          />
        </Field>
        <Field label="Introduction" wide>
          <Textarea
            disabled={ro}
            rows={2}
            value={q.intro}
            onChange={(e) => setField("intro", e.target.value)}
          />
        </Field>
      </section>

      <section aria-label="Options" className="bg-card rounded-xl border">
        <div
          role="tablist"
          aria-label="Quotation options"
          className="flex flex-wrap items-center gap-1 border-b p-2"
        >
          {q.options.map((o, i) => (
            <button
              key={o.id}
              role="tab"
              type="button"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${i === active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {o.name || "Untitled"}
              {q.selectedOptionId === o.id && (
                <span className="ml-1 text-xs opacity-80">(selected)</span>
              )}
            </button>
          ))}
          {!ro && q.options.length < MAX_OPTIONS && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                edit((d) => ({
                  ...d,
                  options: [
                    ...d.options,
                    newEditorOption(
                      OPTION_NAMES[d.options.length] ?? `Option ${d.options.length + 1}`,
                    ),
                  ],
                }));
                setActive(q.options.length);
              }}
            >
              <Plus className="size-4" aria-hidden /> Add option
            </Button>
          )}
        </div>

        {option && (
          <div className="flex flex-col gap-4 p-4" role="tabpanel">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Option name">
                <Input
                  disabled={ro}
                  value={option.name}
                  onChange={(e) => setOption(active, { name: e.target.value })}
                />
              </Field>
              {!ro && (
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input
                    type="radio"
                    name="selected-option"
                    checked={q.selectedOptionId === option.id}
                    onChange={() => setField("selectedOptionId", option.id)}
                  />
                  Selected / recommended
                </label>
              )}
              {!ro && q.options.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => {
                    edit((d) => ({
                      ...d,
                      selectedOptionId: d.selectedOptionId === option.id ? "" : d.selectedOptionId,
                      options: d.options.filter((_, i) => i !== active),
                    }));
                    setActive(0);
                  }}
                >
                  <Trash2 className="size-4" aria-hidden /> Remove option
                </Button>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {option.items.length === 0 && (
                <p className="text-muted-foreground py-4 text-center text-sm">No line items yet.</p>
              )}
              {option.items.map((it, ii) => {
                const lineTotal =
                  Math.round((num(it.quantity) * 100 * Math.round(num(it.unitPrice) * 100)) / 100) /
                  100;
                return (
                  <div
                    key={it.id}
                    className="bg-muted/40 grid gap-2 rounded-lg border p-3 md:grid-cols-12"
                  >
                    <select
                      disabled={ro}
                      aria-label="Type"
                      value={it.type}
                      onChange={(e) =>
                        setItem(active, ii, { type: e.target.value as EditorItem["type"] })
                      }
                      className="border-input bg-background h-8 rounded-lg border px-2 text-sm md:col-span-2"
                    >
                      {ITEM_TYPES.map((tp) => (
                        <option key={tp} value={tp}>
                          {label(tp)}
                        </option>
                      ))}
                    </select>
                    <Input
                      disabled={ro}
                      aria-label="Description"
                      placeholder="Description *"
                      value={it.description}
                      onChange={(e) => setItem(active, ii, { description: e.target.value })}
                      className="md:col-span-5"
                    />
                    <Input
                      disabled={ro}
                      aria-label="Quantity"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Qty"
                      value={it.quantity}
                      onChange={(e) => setItem(active, ii, { quantity: e.target.value })}
                      className="md:col-span-1"
                    />
                    <Input
                      disabled={ro}
                      aria-label="Unit price"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Unit price"
                      value={it.unitPrice}
                      onChange={(e) => setItem(active, ii, { unitPrice: e.target.value })}
                      className="md:col-span-2"
                    />
                    <div className="flex items-center justify-between gap-1 md:col-span-2">
                      <span className="text-sm font-medium">{money(lineTotal)}</span>
                      {!ro && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove line"
                          onClick={() =>
                            setOption(active, { items: option.items.filter((_, j) => j !== ii) })
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                    {canSeeCost && (
                      <div className="flex flex-wrap items-center gap-2 border-t pt-2 md:col-span-12">
                        <span className="text-muted-foreground text-xs font-medium uppercase">
                          Supplier cost (private)
                        </span>
                        <Input
                          disabled={ro}
                          aria-label="Unit cost"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Unit cost"
                          value={it.unitCost}
                          onChange={(e) => setItem(active, ii, { unitCost: e.target.value })}
                          className="w-32"
                        />
                        <Input
                          disabled={ro}
                          aria-label="Markup percent"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Markup %"
                          value={it.markupPercent}
                          onChange={(e) => setItem(active, ii, { markupPercent: e.target.value })}
                          className="w-28"
                        />
                        {!ro && (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={it.unitCost === "" || it.markupPercent === ""}
                            onClick={() =>
                              setItem(active, ii, {
                                unitPrice: String(
                                  priceFromCost(num(it.unitCost), num(it.markupPercent)),
                                ),
                              })
                            }
                          >
                            <Calculator className="size-3.5" aria-hidden /> Price = cost + markup
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {!ro && (
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={option.items.length >= MAX_ITEMS}
                    onClick={() => setOption(active, { items: [...option.items, newEditorItem()] })}
                  >
                    <Plus className="size-4" aria-hidden /> Add line item
                  </Button>
                </div>
              )}
            </div>

            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Discount">
                  <select
                    disabled={ro}
                    value={option.discountType}
                    onChange={(e) =>
                      setOption(active, {
                        discountType: e.target.value as EditorOption["discountType"],
                      })
                    }
                    className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
                  >
                    <option value="NONE">None</option>
                    <option value="PERCENT">Percent (%)</option>
                    <option value="FIXED">Fixed amount</option>
                  </select>
                </Field>
                <Field label="Discount value">
                  <Input
                    disabled={ro || option.discountType === "NONE"}
                    type="number"
                    min="0"
                    step="0.01"
                    value={option.discountValue}
                    onChange={(e) => setOption(active, { discountValue: e.target.value })}
                  />
                </Field>
                <Field label="Tax rate (%)">
                  <Input
                    disabled={ro}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={option.taxRate}
                    onChange={(e) => setOption(active, { taxRate: e.target.value })}
                  />
                </Field>
              </div>
              <dl
                className="bg-muted/40 grid grid-cols-2 gap-y-1 rounded-lg border p-3 text-sm"
                aria-label="Totals"
              >
                <dt>Subtotal</dt>
                <dd className="text-right">{money(t.t.subtotal)}</dd>
                <dt>Discount</dt>
                <dd className="text-right">− {money(t.t.discount)}</dd>
                <dt>Tax</dt>
                <dd className="text-right">{money(t.t.tax)}</dd>
                <dt className="border-t pt-1 font-semibold">Total</dt>
                <dd className="border-t pt-1 text-right font-semibold">{money(t.t.total)}</dd>
                {canSeeProfit && (
                  <>
                    <dt className="text-muted-foreground pt-2">Profit (private)</dt>
                    <dd className="pt-2 text-right">
                      {t.profit
                        ? `${money(t.profit.profit)}${t.profit.marginPercent !== null ? ` · ${t.profit.marginPercent.toFixed(1)}%` : ""}`
                        : "Enter a cost on every line"}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          </div>
        )}
      </section>

      <section className="bg-card grid gap-4 rounded-xl border p-5">
        <Field label="Payment terms">
          <Textarea
            disabled={ro}
            rows={2}
            value={q.paymentTerms}
            onChange={(e) => setField("paymentTerms", e.target.value)}
          />
        </Field>
        <Field label="Cancellation policy">
          <Textarea
            disabled={ro}
            rows={3}
            value={q.cancellationPolicy}
            onChange={(e) => setField("cancellationPolicy", e.target.value)}
          />
        </Field>
        <Field label="Terms and conditions">
          <Textarea
            disabled={ro}
            rows={5}
            value={q.terms}
            onChange={(e) => setField("terms", e.target.value)}
          />
        </Field>
        <Field label="Internal notes (not shown to the customer)">
          <Textarea
            disabled={ro}
            rows={2}
            value={q.notes}
            onChange={(e) => setField("notes", e.target.value)}
          />
        </Field>
      </section>
    </div>
  );
}

function Field({
  label: text,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm font-medium ${wide ? "sm:col-span-2" : ""}`}>
      {text}
      {children}
    </label>
  );
}
