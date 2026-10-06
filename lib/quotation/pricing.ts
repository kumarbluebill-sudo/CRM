/**
 * Pricing math. The database is the source of truth (triggers compute stored totals);
 * this mirror powers the live preview in the editor and is tested for parity with SQL.
 * All arithmetic is done in integer paise to avoid floating-point drift.
 */
export type DiscountType = "NONE" | "PERCENT" | "FIXED";

export type PriceLine = { quantity: number; unitPrice: number; unitCost?: number | null };

export type OptionTotals = {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
};

const paise = (n: number) => Math.round(n * 100);
const money = (p: number) => p / 100;

/** round(quantity * unit_price, 2), as Postgres numeric would. */
export function lineTotalPaise(quantity: number, unitPrice: number): number {
  return Math.round((Math.round(quantity * 100) * paise(unitPrice)) / 100);
}

export function computeOption(
  lines: PriceLine[],
  discountType: DiscountType,
  discountValue: number,
  taxRate: number,
): OptionTotals {
  const sub = lines.reduce((s, l) => s + lineTotalPaise(l.quantity, l.unitPrice), 0);
  const dv = paise(discountValue);
  const disc =
    discountType === "PERCENT"
      ? Math.round((sub * dv) / 10000)
      : discountType === "FIXED"
        ? Math.min(dv, sub)
        : 0;
  const tax = Math.round(((sub - disc) * Math.round(taxRate * 100)) / 10000);
  return {
    subtotal: money(sub),
    discount: money(disc),
    tax: money(tax),
    total: money(sub - disc + tax),
  };
}

/** Profit before tax = (subtotal - discount) - cost. Null unless every line has a cost. */
export function computeProfit(
  lines: PriceLine[],
  totals: OptionTotals,
): { profit: number; marginPercent: number | null } | null {
  if (lines.length === 0 || lines.some((l) => l.unitCost === null || l.unitCost === undefined)) {
    return null;
  }
  const cost = lines.reduce((s, l) => s + lineTotalPaise(l.quantity, l.unitCost as number), 0);
  const net = paise(totals.subtotal) - paise(totals.discount);
  const profit = net - cost;
  return { profit: money(profit), marginPercent: net > 0 ? (profit / net) * 100 : null };
}

/** Suggested selling price from cost + markup % (helper for people who can see costs). */
export function priceFromCost(unitCost: number, markupPercent: number): number {
  return money(Math.round((paise(unitCost) * (10000 + Math.round(markupPercent * 100))) / 10000));
}

export function formatMoney(amount: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
