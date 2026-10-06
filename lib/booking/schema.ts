import { z } from "zod";

export const BOOKING_STATUSES = [
  "DRAFT",
  "PAYMENT_PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export const CONFIRMATION_STATUSES = ["PENDING", "REQUESTED", "CONFIRMED", "CANCELLED"] as const;
export const SUPPLIER_TYPES = [
  "HOTEL",
  "TRANSPORT",
  "FLIGHT",
  "ACTIVITY",
  "GUIDE",
  "DMC",
  "VISA",
  "INSURANCE",
  "RESTAURANT",
  "OTHER",
] as const;
export const SERVICE_TYPES = [
  "HOTEL",
  "TRANSPORT",
  "ACTIVITY",
  "FLIGHT",
  "VISA",
  "INSURANCE",
  "MEAL",
  "OTHER",
] as const;
export const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;
export const MAX_PASSENGERS = 50;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess(blank, s.optional());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");
const phone = z
  .string()
  .trim()
  .regex(/^[+0-9 ()-]{5,20}$/, "Enter a valid phone number");

export const passengerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the passenger's full name").max(150),
  dateOfBirth: opt(isoDate),
  gender: opt(z.enum(GENDERS)),
  nationality: opt(z.string().trim().max(100)),
  specialRequirements: opt(z.string().trim().max(1000)),
});

/** Passport numbers are normalised to upper-case alphanumerics before validation. */
export const passportSchema = z.object({
  passportNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .pipe(
      z.string().regex(/^[A-Z0-9]{6,12}$/, "Enter a valid passport number (6–12 letters/digits)"),
    ),
  passportExpiry: opt(isoDate),
  passportCountry: opt(z.string().trim().max(100)),
});

export const bookingItemSchema = z.object({
  description: z.string().trim().min(1, "Enter a description").max(500),
  supplierId: opt(z.string().uuid()),
  serviceDate: opt(isoDate),
  confirmationStatus: z.enum(CONFIRMATION_STATUSES).default("PENDING"),
  confirmationReference: opt(z.string().trim().max(100)),
  notes: opt(z.string().trim().max(1000)),
});

export const newBookingItemSchema = z.object({
  type: z.enum(SERVICE_TYPES),
  description: z.string().trim().min(1, "Enter a description").max(500),
  quantity: z.preprocess(blank, z.coerce.number().positive().max(100000).default(1)),
  supplierId: opt(z.string().uuid()),
  serviceDate: opt(isoDate),
});

export const bookingUpdateSchema = z
  .object({
    title: z.string().trim().min(2, "Enter a title").max(200),
    destination: opt(z.string().trim().max(200)),
    travelStart: opt(isoDate),
    travelEnd: opt(isoDate),
    adults: z.preprocess(blank, z.coerce.number().int().min(0).max(200).default(1)),
    children: z.preprocess(blank, z.coerce.number().int().min(0).max(200).default(0)),
    notes: opt(z.string().trim().max(5000)),
  })
  .refine((v) => !v.travelStart || !v.travelEnd || v.travelEnd >= v.travelStart, {
    path: ["travelEnd"],
    message: "Return must be on or after departure",
  });

export const supplierSchema = z.object({
  type: z.enum(SUPPLIER_TYPES),
  companyName: z.string().trim().min(2, "Enter the company name").max(150),
  contactName: opt(z.string().trim().max(150)),
  phone: opt(phone),
  email: opt(z.string().trim().toLowerCase().email("Enter a valid email")),
  destination: opt(z.string().trim().max(200)),
  paymentTerms: opt(z.string().trim().max(1000)),
  notes: opt(z.string().trim().max(5000)),
  isActive: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

export const supplierContactSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(150),
  role: opt(z.string().trim().max(100)),
  phone: opt(phone),
  email: opt(z.string().trim().toLowerCase().email("Enter a valid email")),
});

export const supplierServiceSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a service name").max(200),
    description: opt(z.string().trim().max(1000)),
    unitRate: opt(z.coerce.number().min(0).max(1_000_000_000)),
    currency: z.preprocess(blank, z.string().length(3).toUpperCase().default("INR")),
    validFrom: opt(isoDate),
    validTo: opt(isoDate),
  })
  .refine((v) => !v.validFrom || !v.validTo || v.validTo >= v.validFrom, {
    path: ["validTo"],
    message: "End date must be after the start",
  });

/** "M1234567" -> "••••567" (never more than the last three characters). */
export function maskPassport(n: string): string {
  return n.length <= 3
    ? "•".repeat(n.length)
    : `${"•".repeat(Math.min(n.length - 3, 6))}${n.slice(-3)}`;
}

/** Many countries require a passport valid for at least six months after the trip. */
export function passportExpiryWarning(
  expiry: string | null,
  travelEnd: string | null,
): string | null {
  if (!expiry) return null;
  const e = new Date(`${expiry}T00:00:00Z`);
  const ref = travelEnd ? new Date(`${travelEnd}T00:00:00Z`) : new Date();
  if (e < ref) return "Passport expires before the trip ends.";
  const limit = new Date(ref);
  limit.setUTCMonth(limit.getUTCMonth() + 6);
  return e < limit ? "Passport is valid for less than 6 months after the trip." : null;
}
