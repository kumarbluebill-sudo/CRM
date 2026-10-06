import { z } from "zod";

export const ITEM_TYPES = [
  "HOTEL",
  "TRANSPORT",
  "ACTIVITY",
  "FLIGHT",
  "VISA",
  "INSURANCE",
  "MEAL",
  "OTHER",
] as const;
export type QuotationItemType = (typeof ITEM_TYPES)[number];
export const DISCOUNT_TYPES = ["NONE", "PERCENT", "FIXED"] as const;
export const QUOTATION_STATUSES = [
  "DRAFT",
  "SENT",
  "VIEWED",
  "NEGOTIATION",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CONVERTED",
] as const;
export const MAX_OPTIONS = 5;
export const MAX_ITEMS = 100;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const uuid = z.string().uuid();
const money = z.coerce.number().min(0).max(1_000_000_000);
// Blank/missing -> null; anything else must be a number between 0 and 1e9.
const optionalMoney = z
  .preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().min(0).max(1_000_000_000).nullable(),
  )
  .optional()
  .transform((v) => v ?? null);

export const quotationItemSchema = z.object({
  id: uuid,
  type: z.enum(ITEM_TYPES),
  description: z.string().trim().min(1, "Describe every line item").max(500),
  quantity: z.coerce.number().positive("Quantity must be above 0").max(100000),
  unitPrice: money,
  unitCost: optionalMoney,
  markupPercent: optionalMoney,
});

export const quotationOptionSchema = z
  .object({
    id: uuid,
    name: z.string().trim().min(1, "Name every option").max(80),
    discountType: z.enum(DISCOUNT_TYPES).default("NONE"),
    discountValue: money.default(0),
    taxRate: z.coerce.number().min(0).max(100).default(0),
    items: z.array(quotationItemSchema).max(MAX_ITEMS),
  })
  .refine((o) => o.discountType !== "PERCENT" || o.discountValue <= 100, {
    path: ["discountValue"],
    message: "A percentage discount cannot exceed 100",
  });

export const quotationDocSchema = z.object({
  title: z.string().trim().min(2, "Enter a title").max(200),
  leadId: uuid.nullish().transform((v) => v ?? null),
  itineraryId: uuid.nullish().transform((v) => v ?? null),
  validUntil: z
    .string()
    .nullish()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid date")
    .transform((v) => (v ? v : null)),
  intro: text(3000),
  terms: text(10000),
  cancellationPolicy: text(5000),
  paymentTerms: text(3000),
  notes: text(5000),
  selectedOptionId: uuid.nullish().transform((v) => v ?? null),
  options: z.array(quotationOptionSchema).min(1).max(MAX_OPTIONS),
});
export type QuotationDocInput = z.input<typeof quotationDocSchema>;

/* ---------- editor state (numbers held as strings so typing decimals works) ---------- */

export type EditorItem = {
  id: string;
  type: QuotationItemType;
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
  markupPercent: string;
};
export type EditorOption = {
  id: string;
  name: string;
  discountType: (typeof DISCOUNT_TYPES)[number];
  discountValue: string;
  taxRate: string;
  items: EditorItem[];
  /** Server-computed values for display. */
  profit: number | null;
};
export type EditorQuotation = {
  title: string;
  leadId: string;
  itineraryId: string;
  validUntil: string;
  intro: string;
  terms: string;
  cancellationPolicy: string;
  paymentTerms: string;
  notes: string;
  selectedOptionId: string;
  options: EditorOption[];
};

type Loose = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function toEditor(raw: Loose): EditorQuotation {
  const options = Array.isArray(raw.options) ? (raw.options as Loose[]) : [];
  return {
    title: s(raw.title),
    leadId: s(raw.leadId),
    itineraryId: s(raw.itineraryId),
    validUntil: s(raw.validUntil),
    intro: s(raw.intro),
    terms: s(raw.terms),
    cancellationPolicy: s(raw.cancellationPolicy),
    paymentTerms: s(raw.paymentTerms),
    notes: s(raw.notes),
    selectedOptionId: s(raw.selectedOptionId),
    options: options.map((o) => ({
      id: s(o.id),
      name: s(o.name),
      discountType: (DISCOUNT_TYPES as readonly string[]).includes(s(o.discountType))
        ? (s(o.discountType) as "NONE")
        : "NONE",
      discountValue: s(o.discountValue),
      taxRate: s(o.taxRate),
      profit: o.profit === null || o.profit === undefined ? null : Number(o.profit),
      items: (Array.isArray(o.items) ? (o.items as Loose[]) : []).map((i) => ({
        id: s(i.id),
        type: (ITEM_TYPES as readonly string[]).includes(s(i.type))
          ? (s(i.type) as QuotationItemType)
          : "OTHER",
        description: s(i.description),
        quantity: s(i.quantity),
        unitPrice: s(i.unitPrice),
        unitCost: s(i.unitCost),
        markupPercent: s(i.markupPercent),
      })),
    })),
  };
}

export function fromEditor(e: EditorQuotation, includeCost: boolean) {
  return {
    title: e.title,
    leadId: e.leadId || null,
    itineraryId: e.itineraryId || null,
    validUntil: e.validUntil || null,
    intro: e.intro,
    terms: e.terms,
    cancellationPolicy: e.cancellationPolicy,
    paymentTerms: e.paymentTerms,
    notes: e.notes,
    selectedOptionId: e.selectedOptionId || null,
    options: e.options.map((o) => ({
      id: o.id,
      name: o.name,
      discountType: o.discountType,
      discountValue: o.discountValue === "" ? 0 : o.discountValue,
      taxRate: o.taxRate === "" ? 0 : o.taxRate,
      items: o.items.map((i) => ({
        id: i.id,
        type: i.type,
        description: i.description,
        quantity: i.quantity === "" ? 0 : i.quantity,
        unitPrice: i.unitPrice === "" ? 0 : i.unitPrice,
        unitCost: includeCost ? i.unitCost : null,
        markupPercent: includeCost ? i.markupPercent : null,
      })),
    })),
  };
}

export const newEditorItem = (type: QuotationItemType = "HOTEL"): EditorItem => ({
  id: crypto.randomUUID(),
  type,
  description: "",
  quantity: "1",
  unitPrice: "0",
  unitCost: "",
  markupPercent: "",
});

export const newEditorOption = (name: string): EditorOption => ({
  id: crypto.randomUUID(),
  name,
  discountType: "NONE",
  discountValue: "0",
  taxRate: "0",
  items: [],
  profit: null,
});
