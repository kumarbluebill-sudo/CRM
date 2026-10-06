import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { extractText, getDocumentProxy } from "unpdf";
import { QuotationPdf, pdfMoney, type PdfProps } from "@/lib/pdf/quotation-pdf";
import { computeOption, computeProfit, lineTotalPaise } from "@/lib/quotation/pricing";
import { quotationDocSchema } from "@/lib/quotation/schema";

// 1x1 transparent PNG
const LOGO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const props: PdfProps = {
  quotation: {
    number: "Q-2026-0007",
    title: "Dubai Family Holiday",
    currency: "INR",
    validUntil: "2026-12-31",
    intro: "Thank you for choosing us.",
    terms: "Rates subject to availability.",
    cancellationPolicy: "Free cancellation up to 30 days.",
    paymentTerms: "50% advance.",
    selectedOptionId: "o2",
    options: [
      {
        id: "o1",
        name: "Option A – Standard",
        subtotal: 100000,
        discountAmount: 0,
        taxAmount: 5000,
        taxRate: 5,
        total: 105000,
        items: [
          {
            id: "i1",
            type: "HOTEL",
            description: "Standard hotel 4N",
            quantity: 1,
            unitPrice: 100000,
            lineTotal: 100000,
          },
        ],
      },
      {
        id: "o2",
        name: "Option B – Premium",
        subtotal: 150000,
        discountAmount: 10000,
        taxAmount: 7000,
        taxRate: 5,
        total: 147000,
        items: [
          {
            id: "i2",
            type: "HOTEL",
            description: "Atlantis premium 4N",
            quantity: 1,
            unitPrice: 150000,
            lineTotal: 150000,
          },
        ],
      },
    ],
  },
  customer: { name: "Asha Sharma", phone: "+91 98765 43210", email: "asha@example.com" },
  itinerary: {
    destination: "Dubai",
    startDate: "2026-12-12",
    adults: 2,
    children: 1,
    summary: "Five days of sun and sightseeing.",
    inclusions: ["Daily breakfast"],
    exclusions: ["International flights"],
    days: [
      {
        title: "Arrival",
        items: [
          { type: "TRANSFER", title: "Airport pickup", time: "10:30" },
          { type: "HOTEL", title: "Atlantis The Palm", location: "Palm Jumeirah" },
        ],
      },
      { title: "Desert safari", items: [{ type: "ACTIVITY", title: "Dune bashing" }] },
    ],
  },
  branding: {
    orgName: "Sunrise Holidays",
    logo: LOGO,
    primary: "#112233",
    accent: "#ff9900",
    phone: "+91 11111 22222",
    email: "hello@sunrise.test",
    website: "https://sunrise.test",
    address: "12 Beach Road, Goa",
    gst: "29ABCDE1234F1Z5",
    footer: "Sunrise Holidays – crafted journeys",
  },
};

async function pdfText(p: PdfProps) {
  const buf = await renderToBuffer(createElement(QuotationPdf, p) as never);
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return { buf, text, pages: pdf.numPages };
}

describe("quotation PDF", () => {
  it("renders a multi-page branded PDF with all sections", async () => {
    const { buf, text, pages } = await pdfText(props);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages).toBeGreaterThanOrEqual(7);
    for (const s of [
      "Dubai Family Holiday",
      "Prepared for Asha Sharma",
      "Q-2026-0007",
      "Trip summary",
      "Day-wise itinerary",
      "Arrival",
      "Hotels",
      "Atlantis The Palm",
      "Services",
      "Pricing",
      "Option B",
      "Inclusions",
      "Daily breakfast",
      "Exclusions",
      "Terms and conditions",
      "Free cancellation",
      "Contact us",
      "Sunrise Holidays",
      "hello@sunrise.test",
      "29ABCDE1234F1Z5",
      "12 Beach Road, Goa",
    ]) {
      expect(text, s).toContain(s);
    }
  });

  it("prints amounts with the currency code and correct totals", async () => {
    const { text } = await pdfText(props);
    expect(text).toContain("INR 1,47,000.00");
    expect(text).toContain("INR 1,05,000.00");
    expect(pdfMoney(1234.5, "INR")).toBe("INR 1,234.50");
  });

  it("works without logo, itinerary and branding details", async () => {
    const { buf, text } = await pdfText({
      ...props,
      itinerary: null,
      branding: { orgName: "Plain Travels" },
    });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(text).toContain("Plain Travels");
    expect(text).not.toContain("Day-wise itinerary");
  });

  it("ignores malformed brand colours instead of failing", async () => {
    const { buf } = await pdfText({
      ...props,
      branding: { ...props.branding, primary: "red; background:url(x)", accent: "#zzz" },
    });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("cannot render supplier costs: the PDF input type has no cost fields", async () => {
    const leaky = JSON.parse(JSON.stringify(props));
    leaky.quotation.options[0].items[0].unitCost = 77777; // even if it sneaks into data...
    const { text } = await pdfText(leaky);
    expect(text).not.toContain("77777"); // ...it is never printed
    expect(text).not.toMatch(/profit|margin|supplier cost/i);
  });
});

describe("pricing helpers", () => {
  it("line totals round like SQL numeric", () => {
    expect(lineTotalPaise(3, 333.33)).toBe(99999);
    expect(lineTotalPaise(0.33, 10.01)).toBe(330);
    expect(lineTotalPaise(1.5, 99.99)).toBe(14999); // 149.985 rounds half away from zero
  });

  it("computes totals for each discount type and caps fixed discounts", () => {
    const lines = [{ quantity: 2, unitPrice: 500 }];
    expect(computeOption(lines, "NONE", 0, 18)).toEqual({
      subtotal: 1000,
      discount: 0,
      tax: 180,
      total: 1180,
    });
    expect(computeOption(lines, "PERCENT", 10, 0)).toEqual({
      subtotal: 1000,
      discount: 100,
      tax: 0,
      total: 900,
    });
    expect(computeOption(lines, "FIXED", 5000, 0).discount).toBe(1000);
  });

  it("profit needs a cost on every line and is computed before tax", () => {
    const lines = [{ quantity: 1, unitPrice: 1500, unitCost: 1000 }];
    const t = computeOption(lines, "PERCENT", 10, 18);
    expect(computeProfit(lines, t)).toEqual({ profit: 350, marginPercent: (350 / 1350) * 100 });
    expect(computeProfit([{ quantity: 1, unitPrice: 1, unitCost: null }], t)).toBeNull();
    expect(computeProfit([], t)).toBeNull();
  });
});

describe("quotationDocSchema", () => {
  const id = () => crypto.randomUUID();
  const base = {
    title: "Trip",
    options: [
      {
        id: id(),
        name: "A",
        items: [{ id: id(), type: "HOTEL", description: "x", quantity: 1, unitPrice: 10 }],
      },
    ],
  };

  it("accepts a valid document and treats blank cost as null", () => {
    const r = quotationDocSchema.parse({
      ...base,
      options: [{ ...base.options[0], items: [{ ...base.options[0].items[0], unitCost: "" }] }],
    });
    expect(r.options[0].items[0].unitCost).toBeNull();
    expect(r.options[0].discountType).toBe("NONE");
  });

  it("rejects bad input", () => {
    const item = base.options[0].items[0];
    const bad = [
      { ...base, options: [] },
      { ...base, options: Array.from({ length: 6 }, () => ({ ...base.options[0], id: id() })) },
      { ...base, options: [{ ...base.options[0], items: [{ ...item, unitPrice: -5 }] }] },
      { ...base, options: [{ ...base.options[0], items: [{ ...item, quantity: 0 }] }] },
      { ...base, options: [{ ...base.options[0], items: [{ ...item, type: "HACK" }] }] },
      { ...base, options: [{ ...base.options[0], items: [{ ...item, id: "nope" }] }] },
      { ...base, options: [{ ...base.options[0], discountType: "PERCENT", discountValue: 150 }] },
    ];
    for (const b of bad) expect(quotationDocSchema.safeParse(b).success).toBe(false);
  });

  it("drops unknown keys such as organization_id and status", () => {
    const r = quotationDocSchema.parse({
      ...base,
      organization_id: "x",
      status: "APPROVED",
      quotation_number: "Q-1",
    });
    expect(r).not.toHaveProperty("organization_id");
    expect(r).not.toHaveProperty("status");
    expect(r).not.toHaveProperty("quotation_number");
  });
});
