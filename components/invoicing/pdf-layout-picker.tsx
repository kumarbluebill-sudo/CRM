"use client";

import { useId, useState } from "react";
import { Download } from "lucide-react";
import { INVOICE_LAYOUTS, type InvoiceLayout } from "@/lib/invoicing/layouts";

/**
 * Opens the invoice PDF in the chosen layout. The default is the agency's own choice from Settings > Invoicing; picking
 * another here only changes this download. Amounts are identical in every layout.
 */
export function PdfLayoutPicker({
  invoiceId,
  defaultLayout,
  label,
}: {
  invoiceId: string;
  defaultLayout: InvoiceLayout;
  label: string;
}) {
  const id = useId();
  const [layout, setLayout] = useState<InvoiceLayout>(defaultLayout);
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="sr-only">
        PDF layout
      </label>
      <select
        id={id}
        value={layout}
        onChange={(e) => setLayout(e.target.value as InvoiceLayout)}
        className="border-input bg-background focus-visible:ring-ring/50 h-8 rounded-lg border px-2 text-sm outline-none focus-visible:ring-3"
      >
        {INVOICE_LAYOUTS.map((l) => (
          <option key={l.key} value={l.key}>
            {l.label}
          </option>
        ))}
      </select>
      <a
        href={`/api/invoices/${invoiceId}/pdf?layout=${layout}`}
        target="_blank"
        rel="noopener noreferrer"
        className="border-input hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium"
      >
        <Download className="size-4" aria-hidden /> {label}
      </a>
    </div>
  );
}
