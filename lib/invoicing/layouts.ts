/**
 * Invoice layouts. A layout only changes how a document LOOKS; every amount, tax line and number comes from the same
 * server-side calculation whichever layout is used. Kept free of PDF code so forms and server actions can import it.
 */
export const INVOICE_LAYOUTS = [
  {
    key: "classic",
    label: "Classic",
    description: "Plain header with a coloured rule, grey table header. The original layout.",
  },
  {
    key: "modern",
    label: "Modern",
    description: "Coloured header band, coloured table header and striped rows.",
  },
  {
    key: "compact",
    label: "Compact",
    description: "Smaller type and tighter spacing, so long invoices stay on fewer pages.",
  },
  {
    key: "detailed",
    label: "Detailed",
    description: "Classic look plus a tax summary by GST rate, as many accountants prefer.",
  },
] as const;

export type InvoiceLayout = (typeof INVOICE_LAYOUTS)[number]["key"];
export const DEFAULT_INVOICE_LAYOUT: InvoiceLayout = "classic";

export const isInvoiceLayout = (v: unknown): v is InvoiceLayout =>
  typeof v === "string" && INVOICE_LAYOUTS.some((l) => l.key === v);

/** An unknown or missing value falls back to the default rather than failing a download. */
export const toInvoiceLayout = (v: unknown): InvoiceLayout =>
  isInvoiceLayout(v) ? v : DEFAULT_INVOICE_LAYOUT;
