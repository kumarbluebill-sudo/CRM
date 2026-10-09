import { z } from "zod";
import { TEMPLATE_KEYS } from "@/lib/packages/templates";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const money = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(/,/g, ""))) : v),
  z.number().min(0).max(100_000_000).multipleOf(0.01, "Use at most 2 decimals.").optional(),
);
const hex = z.preprocess(
  blank,
  z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1a73e8")
    .optional(),
);

export const packageDetailsSchema = z.object({
  templateKey: z.enum(TEMPLATE_KEYS),
  primary: hex,
  secondary: hex,
  accent: hex,
  font: z.preprocess(blank, z.enum(["SANS", "SERIF"]).optional()),
  layout: z.preprocess(blank, z.enum(["CLASSIC", "MODERN", "MAGAZINE"]).optional()),
  returnDate: z.preprocess(blank, z.iso.date("Use a valid date.").optional()),
  hotelCategory: z.preprocess(
    blank,
    z
      .enum(["BUDGET", "THREE_STAR", "FOUR_STAR", "FIVE_STAR", "LUXURY", "HOMESTAY", "RESORT"])
      .optional(),
  ),
  accommodation: text(3000),
  transport: text(2000),
  flights: text(2000),
  meals: text(1000),
  activities: text(3000),
  price: money,
  currency: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : "INR"),
    z.string().length(3, "Use a 3-letter currency code."),
  ),
  priceNote: text(300),
  childPrice: money,
  extraPersonPrice: money,
  cancellationPolicy: text(5000),
  terms: text(8000),
  travelNotes: text(5000),
  ctaText: text(300),
});

export type PackageDetailsInput = z.infer<typeof packageDetailsSchema>;

/** Form values -> the JSON the database function expects (theme overrides collected into one object). */
export function toDetailsPayload(v: PackageDetailsInput) {
  const theme: Record<string, string> = {};
  for (const k of ["primary", "secondary", "accent", "font", "layout"] as const)
    if (v[k]) theme[k] = v[k] as string;
  const { primary, secondary, accent, font, layout, ...rest } = v;
  void [primary, secondary, accent, font, layout];
  return { ...rest, theme };
}
