import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { extractText, getDocumentProxy } from "unpdf";
import { InvoicePdf, ReceiptPdf } from "@/lib/pdf/finance-pdf";

const branding = { orgName: "Acme Travels" };
const text = async (buf: Buffer) => {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  return (await extractText(pdf, { mergePages: true })).text;
};

describe("finance PDFs", () => {
  it("renders an invoice with lines, tax adjustment, paid and balance", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = await renderToBuffer(
      createElement(InvoicePdf, {
        invoiceNumber: "INV-2026-0001",
        status: "ISSUED",
        issueDate: "2026-10-01",
        dueDate: null,
        currency: "INR",
        total: 87150,
        paid: 20000,
        bookingNumber: "B-2026-0001",
        tripTitle: "Dubai trip",
        billTo: { name: "Asha Sharma" },
        lines: [
          { description: "Atlantis 4N", quantity: 1, unitPrice: 80000 },
          { description: "Transfers", quantity: 2, unitPrice: 1500 },
        ],
        notes: null,
        branding,
      }) as any,
    );
    const t = await text(buf);
    expect(t).toContain("INV-2026-0001");
    expect(t).toContain("Asha Sharma");
    expect(t).toContain("Taxes and other charges");
    expect(t).toContain("INR 87,150.00");
    expect(t).toContain("INR 67,150.00");
  });
  it("marks voided invoices", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = await renderToBuffer(
      createElement(InvoicePdf, {
        invoiceNumber: "INV-2026-0002",
        status: "VOID",
        issueDate: "2026-10-01",
        dueDate: null,
        currency: "INR",
        total: 100,
        paid: 0,
        bookingNumber: "B",
        tripTitle: "T",
        billTo: { name: "X Y" },
        lines: [],
        notes: null,
        branding,
      }) as any,
    );
    expect(await text(buf)).toContain("VOID");
  });
  it("renders a receipt", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = await renderToBuffer(
      createElement(ReceiptPdf, {
        receiptNumber: "RC-2026-0001",
        paidAt: "2026-10-02",
        amount: 20000,
        currency: "INR",
        method: "UPI",
        reference: "UTR1",
        bookingNumber: "B-2026-0001",
        tripTitle: "Dubai trip",
        customerName: "Asha Sharma",
        bookingTotal: 87150,
        bookingPaid: 20000,
        branding,
      }) as any,
    );
    const t = await text(buf);
    expect(t).toContain("RC-2026-0001");
    expect(t).toContain("INR 20,000.00");
    expect(t).toContain("UTR1");
  });
});
