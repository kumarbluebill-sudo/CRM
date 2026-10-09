"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  cancelDraftInvoiceAction,
  issueInvoiceFromDraftAction,
  saveDraftInvoiceAction,
} from "@/app/(app)/payments/invoices/actions";

type Line = {
  key: string;
  description: string;
  taxCodeId: string;
  quantity: string;
  unitPrice: string;
  discount: string;
};

export type EditorInvoice = {
  id: string;
  dueDate: string;
  notes: string;
  terms: string;
  placeOfSupply: string;
  customerGstin: string;
  billName: string;
  billAddress: string;
  priceIncludesTax: boolean;
};

const selectClass =
  "border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3";

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Edits a DRAFT invoice. The browser sends only descriptions, quantities, prices, discounts and tax-code choices;
 * every tax figure and total is calculated by the database and shown after saving.
 */
export function InvoiceEditor({
  invoice,
  lines: initial,
  taxCodes,
  states,
  registered,
  profileReady,
}: {
  invoice: EditorInvoice;
  lines: {
    description: string;
    taxCodeId: string | null;
    quantity: number;
    unitPrice: number;
    discount: number;
  }[];
  taxCodes: { id: string; name: string; rate: number; verified: boolean; active: boolean }[];
  states: { code: string; name: string }[];
  registered: boolean;
  profileReady: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [head, setHead] = useState(invoice);
  const [lines, setLines] = useState<Line[]>(
    initial.map((l, i) => ({
      key: `l${i}`,
      description: l.description,
      taxCodeId: l.taxCodeId ?? "",
      quantity: String(l.quantity),
      unitPrice: String(l.unitPrice),
      discount: String(l.discount),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<EditorInvoice>) => setHead((h) => ({ ...h, ...patch }));
  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const payload = () => ({
    dueDate: head.dueDate,
    notes: head.notes,
    terms: head.terms,
    placeOfSupply: head.placeOfSupply,
    customerGstin: head.customerGstin,
    billName: head.billName,
    billAddress: head.billAddress,
    priceIncludesTax: head.priceIncludesTax,
    lines: lines.map((l) => ({
      description: l.description,
      taxCodeId: l.taxCodeId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount || "0",
    })),
  });

  const save = (then?: () => void) =>
    start(async () => {
      setError(null);
      const r = await saveDraftInvoiceAction(invoice.id, payload());
      if (!r.ok) {
        setError(r.message ?? "Could not save.");
        return;
      }
      toast.success(r.message ?? "Saved");
      router.refresh();
      then?.();
    });

  const issue = () =>
    start(async () => {
      setError(null);
      const saved = await saveDraftInvoiceAction(invoice.id, payload());
      if (!saved.ok) return void setError(saved.message ?? "Could not save.");
      const r = await issueInvoiceFromDraftAction(invoice.id);
      if (!r.ok) {
        setError(r.message ?? "Could not issue.");
        router.refresh();
        return;
      }
      toast.success(r.message ?? "Issued");
      router.refresh();
    });

  const cancel = () =>
    start(async () => {
      const r = await cancelDraftInvoiceAction(invoice.id);
      if (r.message) (r.ok ? toast.success : toast.error)(r.message);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p
          role="alert"
          className="text-destructive rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950"
        >
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="inv-bill-name" label="Bill to (name)">
          <Input
            id="inv-bill-name"
            value={head.billName}
            maxLength={200}
            onChange={(e) => set({ billName: e.target.value })}
          />
        </Field>
        <Field id="inv-gstin" label="Customer GSTIN (if they have one)">
          <Input
            id="inv-gstin"
            value={head.customerGstin}
            maxLength={15}
            placeholder="27AAPFU0939F1ZV"
            onChange={(e) =>
              set({ customerGstin: e.target.value.toUpperCase().replace(/\s/g, "") })
            }
          />
        </Field>
        <div className="sm:col-span-2">
          <Field id="inv-bill-address" label="Billing address">
            <Textarea
              id="inv-bill-address"
              rows={2}
              value={head.billAddress}
              maxLength={500}
              onChange={(e) => set({ billAddress: e.target.value })}
            />
          </Field>
        </div>
        <Field
          id="inv-place"
          label={registered ? "Place of supply (state)" : "State of supply (optional)"}
        >
          <select
            id="inv-place"
            className={selectClass}
            value={head.placeOfSupply}
            onChange={(e) => set({ placeOfSupply: e.target.value })}
          >
            <option value="">— choose —</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="inv-due" label="Due date">
          <Input
            id="inv-due"
            type="date"
            value={head.dueDate}
            onChange={(e) => set({ dueDate: e.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
          <input
            type="checkbox"
            className="size-4 rounded border"
            checked={head.priceIncludesTax}
            onChange={(e) => set({ priceIncludesTax: e.target.checked })}
          />
          Prices on the lines already include tax
        </label>
      </div>

      <section aria-label="Invoice lines" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Lines</h2>
        <div className="hidden gap-2 px-1 text-xs font-medium sm:grid sm:grid-cols-[1fr_11rem_5rem_7rem_6rem_2rem]">
          <span>Description</span>
          <span>{registered ? "Tax code" : "Tax code (not used)"}</span>
          <span>Qty</span>
          <span>Unit price</span>
          <span>Discount</span>
          <span />
        </div>
        {lines.map((l, i) => (
          <div
            key={l.key}
            className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_11rem_5rem_7rem_6rem_2rem] sm:border-0 sm:p-0"
          >
            <Input
              aria-label={`Line ${i + 1} description`}
              value={l.description}
              maxLength={500}
              onChange={(e) => setLine(l.key, { description: e.target.value })}
            />
            <select
              aria-label={`Line ${i + 1} tax code`}
              className={selectClass}
              value={l.taxCodeId}
              disabled={!registered}
              onChange={(e) => setLine(l.key, { taxCodeId: e.target.value })}
            >
              <option value="">{registered ? "— choose —" : "No tax"}</option>
              {taxCodes
                .filter((t) => t.active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.rate}%){t.verified ? "" : " – unverified"}
                  </option>
                ))}
            </select>
            <Input
              aria-label={`Line ${i + 1} quantity`}
              inputMode="decimal"
              value={l.quantity}
              onChange={(e) => setLine(l.key, { quantity: e.target.value })}
            />
            <Input
              aria-label={`Line ${i + 1} unit price`}
              inputMode="decimal"
              value={l.unitPrice}
              onChange={(e) => setLine(l.key, { unitPrice: e.target.value })}
            />
            <Input
              aria-label={`Line ${i + 1} discount`}
              inputMode="decimal"
              value={l.discount}
              onChange={(e) => setLine(l.key, { discount: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove line ${i + 1}`}
              disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={lines.length >= 100}
            onClick={() =>
              setLines((ls) => [
                ...ls,
                {
                  key: `n${Date.now()}${ls.length}`,
                  description: "",
                  taxCodeId: ls.at(-1)?.taxCodeId ?? "",
                  quantity: "1",
                  unitPrice: "0",
                  discount: "0",
                },
              ])
            }
          >
            <Plus className="size-4" aria-hidden /> Add line
          </Button>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="inv-notes" label="Notes">
          <Textarea
            id="inv-notes"
            rows={3}
            value={head.notes}
            maxLength={1000}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </Field>
        <Field id="inv-terms" label="Terms and conditions">
          <Textarea
            id="inv-terms"
            rows={3}
            value={head.terms}
            maxLength={3000}
            onChange={(e) => set({ terms: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => save()} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save and recalculate
        </Button>
        <Dialog>
          <DialogTrigger render={<Button variant="outline" disabled={pending || !profileReady} />}>
            Issue invoice…
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Issue this invoice?</DialogTitle>
              <DialogDescription>
                It gets its permanent number and can no longer be edited. Corrections are made with
                a credit note.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={issue} disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Save and issue
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog>
          <DialogTrigger
            render={<Button variant="ghost" className="text-destructive" disabled={pending} />}
          >
            Discard draft…
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Discard this draft?</DialogTitle>
              <DialogDescription>
                The draft is cancelled. No invoice number is used.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="destructive" onClick={cancel} disabled={pending}>
                Discard draft
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {!profileReady && (
          <span className="text-muted-foreground text-xs">
            Complete the invoicing profile in Settings to issue.
          </span>
        )}
      </div>
    </div>
  );
}
