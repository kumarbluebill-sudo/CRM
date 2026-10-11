import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { extractText, getDocumentProxy } from "unpdf";
import { GstDocumentPdf, type GstDocProps } from "@/lib/pdf/gst-pdf";
import {
  DEFAULT_INVOICE_LAYOUT,
  INVOICE_LAYOUTS,
  isInvoiceLayout,
  toInvoiceLayout,
} from "@/lib/invoicing/layouts";

const text = async (buf: Buffer) => {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  return (await extractText(pdf, { mergePages: true })).text;
};

const line = (description: string, taxable: number, rate: number, inter: boolean) => {
  const tax = (taxable * rate) / 100;
  return {
    description,
    sac: "998555",
    quantity: 1,
    unitPrice: taxable,
    rate,
    discount: 0,
    taxable,
    cgst: inter ? 0 : tax / 2,
    sgst: inter ? 0 : tax / 2,
    igst: inter ? tax : 0,
    total: taxable + tax,
  };
};

function doc(over: Partial<GstDocProps> = {}, supply: "INTRA" | "INTER" | "NONE" = "INTRA") {
  const inter = supply === "INTER";
  const rate = supply === "NONE" ? 0 : 5;
  const lines =
    supply === "NONE"
      ? [line("Resort stay", 10000, 0, false), line("Transfers", 2000, 0, false)]
      : [line("Resort stay", 10000, 5, inter), line("Sightseeing", 4000, 18, inter)];
  const subtotal = lines.reduce((t, l) => t + l.taxable, 0);
  const cgst = lines.reduce((t, l) => t + l.cgst, 0);
  const sgst = lines.reduce((t, l) => t + l.sgst, 0);
  const igst = lines.reduce((t, l) => t + l.igst, 0);
  return {
    kind: supply === "NONE" ? "INVOICE" : "TAX_INVOICE",
    number: "INV/26-27/0042",
    date: "2026-10-11",
    dueDate: "2026-10-25",
    primary: "#1d4f91",
    currency: "INR",
    supplier: {
      legalName: "Sunrise Travels Pvt Ltd",
      address: "1 Beach Road, Goa",
      gstin: supply === "NONE" ? null : "30AAPFU0939F1ZV",
      stateCode: "30",
    },
    billTo: { name: "Kavya Iyer", address: "Bengaluru" },
    placeOfSupply: inter ? "29" : "30",
    supplyType: supply,
    reference: "B-2026-0007",
    lines,
    subtotal,
    cgst,
    sgst,
    igst,
    rounding: 0,
    total: subtotal + cgst + sgst + igst,
    payment: { paid: 5000, balance: subtotal + cgst + sgst + igst - 5000, status: "PARTIAL" },
    bank: { accountNo: "123456789012", ifsc: "HDFC0001234" },
    notes: "Thank you",
    terms: "Payment within 14 days",
    ...over,
    // rate is only used to keep the helper honest in the NONE case
    ...(rate < 0 ? {} : {}),
  } as GstDocProps;
}

const render = async (p: GstDocProps) =>
  renderToBuffer(createElement(GstDocumentPdf, p) as never) as Promise<Buffer>;

describe("invoice layouts", () => {
  it("offers four named layouts and falls back safely", () => {
    expect(INVOICE_LAYOUTS.map((l) => l.key)).toEqual(["classic", "modern", "compact", "detailed"]);
    for (const l of INVOICE_LAYOUTS) {
      expect(isInvoiceLayout(l.key)).toBe(true);
      expect(l.label.length).toBeGreaterThan(3);
      expect(l.description.length).toBeGreaterThan(20);
    }
    expect(toInvoiceLayout("modern")).toBe("modern");
    for (const bad of [undefined, null, "", "fancy", "CLASSIC", "../x", 3, {}])
      expect(toInvoiceLayout(bad)).toBe(DEFAULT_INVOICE_LAYOUT);
  });

  it("renders every layout for every supply type and document kind", async () => {
    for (const layout of INVOICE_LAYOUTS.map((l) => l.key))
      for (const supply of ["INTRA", "INTER", "NONE"] as const)
        for (const kind of ["TAX_INVOICE", "INVOICE", "CREDIT_NOTE"] as const) {
          const buf = await render(
            doc(
              { layout, kind, number: kind === "CREDIT_NOTE" ? "CN/26-27/0001" : "INV/26-27/0042" },
              supply,
            ),
          );
          expect(buf.subarray(0, 5).toString(), `${layout} ${supply} ${kind}`).toBe("%PDF-");
          expect(buf.length).toBeGreaterThan(1500);
        }
  });

  it("prints exactly the same figures and parties whatever the layout", async () => {
    const outputs: Record<string, string> = {};
    for (const l of INVOICE_LAYOUTS)
      outputs[l.key] = await text(await render(doc({ layout: l.key })));
    const figures = (t: string) => t.match(/INR [0-9,]+\.\d{2}/g)?.sort() ?? [];
    for (const l of INVOICE_LAYOUTS) {
      const t = outputs[l.key];
      for (const must of [
        "INV/26-27/0042",
        "Kavya Iyer",
        "Sunrise Travels Pvt Ltd",
        "30AAPFU0939F1ZV",
        "Resort stay",
        "Sightseeing",
        "TAX INVOICE",
        "Amount in words",
      ])
        expect(t, `${l.key}: ${must}`).toContain(must);
    }
    // the totals block is the same in all four (the detailed layout adds a table of its own, which repeats the same tax)
    const base = figures(outputs.classic);
    expect(base.length).toBeGreaterThan(4);
    for (const key of ["modern", "compact"]) expect(figures(outputs[key]), key).toEqual(base);
    for (const f of base) expect(outputs.detailed, `detailed has ${f}`).toContain(f);
  });

  it("only the detailed layout adds the tax summary by rate, and only when tax is charged", async () => {
    const t = async (layout: GstDocProps["layout"], supply: "INTRA" | "INTER" | "NONE") =>
      text(await render(doc({ layout }, supply)));
    expect(await t("detailed", "INTRA")).toMatch(/tax summary by gst rate/i);
    expect(await t("detailed", "INTER")).toMatch(/tax summary by gst rate/i);
    expect(await t("detailed", "NONE")).not.toMatch(/tax summary by gst rate/i);
    for (const l of ["classic", "modern", "compact"] as const)
      expect(await t(l, "INTRA"), l).not.toMatch(/tax summary by gst rate/i);
    // 5% and 18% both appear in the summary
    const d = await t("detailed", "INTRA");
    expect(d).toMatch(/5%/);
    expect(d).toMatch(/18%/);
  });

  it("looks different per layout, and a missing layout is the classic one", async () => {
    const bufs = new Map<string, Buffer>();
    for (const l of INVOICE_LAYOUTS) bufs.set(l.key, await render(doc({ layout: l.key })));
    const keys = [...bufs.keys()];
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++)
        expect(bufs.get(keys[i])!.equals(bufs.get(keys[j])!), `${keys[i]} vs ${keys[j]}`).toBe(
          false,
        );
    const none = await text(await render(doc({ layout: undefined })));
    expect(none).toBe(await text(bufs.get("classic")!));
  });

  it("keeps a draft watermark and credit-note wording in every layout", async () => {
    for (const l of INVOICE_LAYOUTS) {
      const t = await text(
        await render(
          doc({
            layout: l.key,
            kind: "CREDIT_NOTE",
            number: null,
            watermark: "DRAFT",
            reason: "Cancelled trip",
          }),
        ),
      );
      expect(t, l.key).toContain("CREDIT NOTE");
      expect(t, l.key).toContain("DRAFT");
      expect(t, l.key).toContain("Cancelled trip");
    }
  });
});
