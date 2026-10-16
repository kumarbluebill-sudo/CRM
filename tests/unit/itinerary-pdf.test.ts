import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import {
  buildItineraryPdfModel,
  dateText,
  dateWithWeekday,
  dayDate,
  perPersonAmount,
  pickQuote,
  toSourceQuotation,
  type PdfSource,
} from "@/lib/itinerary-pdf/model";

import { ItineraryPdf } from "@/lib/pdf/itinerary-pdf";
import { computeOption } from "@/lib/quotation/pricing";
import {
  DEFAULT_SECTIONS,
  DEFAULT_SETTINGS,
  PDF_THEMES,
  parseSettings,
  pdfTheme,
} from "@/lib/itinerary-pdf/themes";

const SECRET_COST = 77777;
const SECRET_MARKUP = 91357;

/** A raw quotation document as the database returns it for a privileged user: it carries costs and markup. */
const rawQuotation = {
  id: "q1",
  number: "Q-2026-0007",
  title: "Goa escape",
  currency: "INR",
  validUntil: "2026-12-31",
  intro: "Thank you for choosing us.",
  paymentTerms: "50% to confirm.",
  selectedOptionId: "o2",
  canSeeCost: true,
  options: [
    { id: "o1", name: "Standard", subtotal: 1000, discountAmount: 0, taxAmount: 50, total: 1050, taxRate: 5, items: [] },
    {
      id: "o2",
      name: "Premium",
      discountType: "PERCENT",
      discountValue: 10,
      taxRate: 5,
      subtotal: 40000,
      discountAmount: 4000,
      taxAmount: 1800,
      total: 37800,
      profit: 654321,
      items: [
        { id: "i1", type: "HOTEL", description: "4 nights at Beach Resort", quantity: 2, unitPrice: 15000, lineTotal: 30000, unitCost: SECRET_COST, markupPercent: SECRET_MARKUP },
        { id: "i2", type: "TRANSPORT", description: "Airport transfers", quantity: 1, unitPrice: 10000, lineTotal: 10000, unitCost: SECRET_COST, markupPercent: SECRET_MARKUP },
      ],
    },
  ],
};

const source = (over: Partial<PdfSource> = {}): PdfSource => ({
  itinerary: {
    title: "Goa escape",
    destination: "Goa",
    summary: "Sun, sand and seafood.\nA relaxed five days.",
    startDate: "2026-12-30",
    adults: 2,
    children: 1,
    inclusions: ["Breakfast", "Transfers"],
    exclusions: ["Flights"],
    days: [
      { title: "Arrival", description: "Check in.", items: [{ type: "HOTEL", title: "Beach Resort", location: "Candolim", time: "14:00" }] },
      { title: "North Goa", description: "Forts and beaches.", items: [{ type: "ACTIVITY", title: "Fort Aguada", time: "10:00" }] },
      { title: "South Goa", items: [] },
      { title: "Spice farm", items: [{ type: "ACTIVITY", title: "Spice walk" }] },
      { title: "Departure", items: [] },
    ],
  },
  package: { cancellationPolicy: "Package cancellation text.", terms: "Package terms." },
  quotations: [toSourceQuotation(rawQuotation)],
  customerName: "Asha Rao",
  branding: { name: "Blue Sky Travels", phone: "+91 98000 00000", email: "hello@bluesky.test", footer: "Blue Sky Travels Pvt Ltd" },
  payment: { bankName: "Test Bank", accountName: "Blue Sky", accountNo: "1234567890", ifsc: "TEST0001234", upi: "bluesky@test" },
  defaults: { terms: "Default terms.", cancellationPolicy: "Default cancellation." },
  dayImageIds: [null, null, null, null, null],
  fallbackCoverId: null,
  ...over,
});

describe("itinerary pdf: dates", () => {
  it("day N is start date + (N - 1)", () => {
    expect(dayDate("2026-03-10", 1)).toBe("2026-03-10");
    expect(dayDate("2026-03-10", 4)).toBe("2026-03-13");
  });
  it("rolls over months, years and leap days", () => {
    expect(dayDate("2026-12-30", 3)).toBe("2027-01-01");
    expect(dayDate("2028-02-28", 2)).toBe("2028-02-29");
    expect(dayDate("2027-02-28", 2)).toBe("2027-03-01");
  });
  it("has no date without a valid start date", () => {
    expect(dayDate(null, 1)).toBeNull();
    expect(dayDate("", 2)).toBeNull();
    expect(dayDate("30/12/2026", 2)).toBeNull();
    expect(dayDate("2026-13-45", 2)).toBeNull();
  });
  it("prints dates the same everywhere", () => {
    expect(dateText("2026-03-05")).toBe("5 Mar 2026");
    expect(dateWithWeekday("2026-03-05")).toBe("Thu, 5 Mar 2026");
  });
  it("the model carries a date for every day", () => {
    const m = buildItineraryPdfModel(source(), DEFAULT_SETTINGS);
    expect(m.days.map((d) => d.date)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(m.days[2].dateText).toBe("Fri, 1 Jan 2027");
    expect(m.durationText).toBe("4 nights / 5 days");
    expect(m.endDateText).toBe("3 Jan 2027");
  });
  it("shows Day N when the trip has no start date", () => {
    const s = source();
    s.itinerary.startDate = null;
    const m = buildItineraryPdfModel(s, DEFAULT_SETTINGS);
    expect(m.days[0].date).toBeNull();
    expect(m.days[0].dateText).toBe("Day 1");
  });
});

describe("itinerary pdf: totals and per person", () => {
  it("copies the stored totals of the chosen option", () => {
    const m = buildItineraryPdfModel(source(), { ...DEFAULT_SETTINGS, quotationId: "q1", optionId: "o2" });
    expect(m.quote).toMatchObject({ subtotal: 40000, discount: 4000, tax: 1800, total: 37800, taxRate: 5 });
    expect(m.quote!.lines.map((l) => [l.description, l.quantity, l.rate, l.amount])).toEqual([
      ["4 nights at Beach Resort", 2, 15000, 30000],
      ["Airport transfers", 1, 10000, 10000],
    ]);
  });
  it("the stored totals match the pricing maths (subtotal - discount + GST)", () => {
    const t = computeOption(
      [{ quantity: 2, unitPrice: 15000 }, { quantity: 1, unitPrice: 10000 }],
      "PERCENT",
      10,
      5,
    );
    expect(t).toEqual({ subtotal: 40000, discount: 4000, tax: 1800, total: 37800 });
  });
  it("splits the total between adults and children", () => {
    const m = buildItineraryPdfModel(source(), DEFAULT_SETTINGS);
    expect(m.quote!.travellers).toBe(3);
    expect(m.quote!.perPerson).toBe(12600);
    expect(m.travellersText).toBe("2 adults, 1 child");
  });
  it("rounds per person to whole paise", () => {
    expect(perPersonAmount(100, 3)).toBe(33.33);
    expect(perPersonAmount(0.05, 2)).toBe(0.03);
    expect(perPersonAmount(1000, 1)).toBe(1000);
  });
  it("has no per-person figure without travellers", () => {
    expect(perPersonAmount(1000, 0)).toBeNull();
    expect(perPersonAmount(Number.NaN, 2)).toBeNull();
    const s = source();
    s.itinerary.adults = 0;
    s.itinerary.children = 0;
    expect(buildItineraryPdfModel(s, DEFAULT_SETTINGS).quote!.perPerson).toBeNull();
  });
  it("uses the selected option unless another is chosen", () => {
    expect(pickQuote(source().quotations, { quotationId: null, optionId: null })!.option.id).toBe("o2");
    expect(pickQuote(source().quotations, { quotationId: "q1", optionId: "o1" })!.option.id).toBe("o1");
    expect(pickQuote(source().quotations, { quotationId: "nope", optionId: "nope" })!.option.id).toBe("o2");
    expect(pickQuote([], { quotationId: null, optionId: null })).toBeNull();
  });
});

describe("itinerary pdf: pages", () => {
  it("is cover, overview, days (3 per page), quotation, policies: 6 pages for 5 days", () => {
    const m = buildItineraryPdfModel(source(), DEFAULT_SETTINGS);
    expect(m.pages.map((p) => p.kind)).toEqual(["cover", "overview", "days", "days", "quote", "policies"]);
    const dayPages = m.pages.filter((p) => p.kind === "days") as { kind: "days"; days: unknown[] }[];
    expect(dayPages.map((p) => p.days.length)).toEqual([3, 2]);
  });
  it("stays within 5 to 7 pages for trips of 1 to 9 days", () => {
    for (let n = 1; n <= 9; n++) {
      const s = source();
      s.itinerary.days = Array.from({ length: n }, (_, i) => ({ title: `Day ${i + 1}`, items: [] }));
      const count = buildItineraryPdfModel(s, DEFAULT_SETTINGS).pages.length;
      expect(count).toBeGreaterThanOrEqual(5);
      expect(count).toBeLessThanOrEqual(7);
    }
  });
  it("section toggles remove pages", () => {
    const off = { ...DEFAULT_SECTIONS, quotation: false, overview: false, days: false };
    const m = buildItineraryPdfModel(source(), { ...DEFAULT_SETTINGS, sections: off });
    expect(m.pages.map((p) => p.kind)).toEqual(["cover", "policies"]);
    expect(m.quote).toBeNull();
    const none = { ...off, inclusions: false, cancellation: false, terms: false, bank: false };
    expect(buildItineraryPdfModel(source(), { ...DEFAULT_SETTINGS, sections: none }).pages.map((p) => p.kind)).toEqual(["cover"]);
  });
  it("cancellation falls back quotation, then package, then agency default", () => {
    const withQ = source();
    withQ.quotations[0].cancellationPolicy = "Quotation cancellation.";
    expect(buildItineraryPdfModel(withQ, DEFAULT_SETTINGS).cancellation).toBe("Quotation cancellation.");
    expect(buildItineraryPdfModel(source(), DEFAULT_SETTINGS).cancellation).toBe("Package cancellation text.");
    const dflt = source({ package: null });
    expect(buildItineraryPdfModel(dflt, DEFAULT_SETTINGS).cancellation).toBe("Default cancellation.");
    expect(buildItineraryPdfModel(dflt, DEFAULT_SETTINGS).terms).toBe("Default terms.");
  });
  it("takes hotels from the package, else from hotel items", () => {
    expect(buildItineraryPdfModel(source(), DEFAULT_SETTINGS).hotels).toEqual([
      { name: "Beach Resort", detail: "Day 1 · Candolim" },
    ]);
    const s = source({ package: { accommodation: "Taj Fort - 3 nights\nSea View Inn: 1 night" } });
    expect(buildItineraryPdfModel(s, DEFAULT_SETTINGS).hotels).toEqual([
      { name: "Taj Fort", detail: "3 nights" },
      { name: "Sea View Inn", detail: "1 night" },
    ]);
  });
});

describe("itinerary pdf: settings and themes", () => {
  it("has the five named themes with valid colours", () => {
    expect(PDF_THEMES.map((t) => t.name)).toEqual([
      "Corporate Navy",
      "Ocean Teal",
      "Charcoal Minimal",
      "Modern Bold",
      "Emerald Executive",
    ]);
    for (const t of PDF_THEMES)
      for (const c of [t.primary, t.accent, t.ink, t.muted, t.tint, t.line, t.onPrimary])
        expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("reads saved settings defensively", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ theme: "nope", sections: { days: "yes", terms: false } })).toEqual({
      ...DEFAULT_SETTINGS,
      sections: { ...DEFAULT_SECTIONS, terms: false },
    });
    expect(parseSettings({ theme: "ocean-teal", optionId: "x" }).theme).toBe("ocean-teal");
    expect(pdfTheme("missing").key).toBe("corporate-navy");
  });
});

describe("itinerary pdf: no internal cost", () => {
  it("copies selling fields only, so cost and markup never reach the model", () => {
    const q = toSourceQuotation(rawQuotation);
    const json = JSON.stringify(q);
    expect(json).not.toContain("unitCost");
    expect(json).not.toContain("markup");
    expect(json).not.toContain("profit");
    expect(json).not.toContain(String(SECRET_COST));
    expect(json).not.toContain(String(SECRET_MARKUP));
    const m = JSON.stringify(buildItineraryPdfModel(source(), DEFAULT_SETTINGS));
    expect(m).not.toContain(String(SECRET_COST));
    expect(m).not.toContain(String(SECRET_MARKUP));
    expect(m).not.toContain("654321");
  });

  it("renders a 5 to 7 page A4 PDF without any cost, markup or profit", async () => {
    const model = buildItineraryPdfModel(source(), { ...DEFAULT_SETTINGS, theme: "ocean-teal" });
    const buf = await renderToBuffer(createElement(ItineraryPdf, { model, images: {} }) as any);
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, buf);
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    expect(pdf.numPages).toBeGreaterThanOrEqual(5);
    expect(pdf.numPages).toBeLessThanOrEqual(7);
    const page = await pdf.getPage(1);
    const [, , w, h] = page.view;
    expect(Math.round(w)).toBe(595);
    expect(Math.round(h)).toBe(842);
    const { text } = await extractText(pdf, { mergePages: true });
    expect(text).toContain("Specially prepared for");
    expect(text).toContain("Asha Rao");
    expect(text).toContain("4 nights / 5 days");
    expect(text).toContain("Fri, 1 Jan 2027");
    expect(text).toContain("INR 37,800");
    expect(text).toContain("INR 12,600");
    expect(text).toContain("Page 1 of");
    for (const bad of [String(SECRET_COST), String(SECRET_MARKUP), "654,321", "654321", /markup/i, /profit/i, /supplier cost/i])
      expect(text).not.toMatch(bad instanceof RegExp ? bad : new RegExp(bad));
  });
});
