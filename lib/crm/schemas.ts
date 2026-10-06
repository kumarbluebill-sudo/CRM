import { z } from "zod";
import {
  HOTEL_CATEGORIES,
  LEAD_STATUSES,
  PRIORITIES,
  TASK_KINDS,
  TASK_STATUSES,
  TRIP_TYPES,
} from "@/lib/crm/constants";

/** HTML forms submit "" for empty inputs; treat that as "not provided". */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blank, schema.optional());
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
const count = (max = 200) =>
  z.preprocess(blank, z.coerce.number().int().min(0).max(max).default(0));

export const uuid = z.string().uuid();
const phone = z
  .string()
  .trim()
  .regex(/^[+0-9 ()-]{5,20}$/, "Enter a valid phone number");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");

export const leadSchema = z
  .object({
    title: z.string().trim().min(2, "Enter a title").max(200),
    customerId: optional(uuid),
    destination: optional(z.string().trim().max(200)),
    departureDate: optional(isoDate),
    returnDate: optional(isoDate),
    adults: z.preprocess(blank, z.coerce.number().int().min(0).max(200).default(1)),
    children: count(),
    infants: count(),
    budget: optional(z.coerce.number().min(0).max(1_000_000_000)),
    currency: z.preprocess(blank, z.string().length(3).toUpperCase().default("INR")),
    tripType: z.enum(TRIP_TYPES).default("LEISURE"),
    hotelCategory: optional(z.enum(HOTEL_CATEGORIES)),
    transportRequired: checkbox,
    visaRequired: checkbox,
    insuranceRequired: checkbox,
    leadSourceId: optional(uuid),
    assignedUserId: optional(uuid),
    priority: z.enum(PRIORITIES).default("MEDIUM"),
    status: z.enum(LEAD_STATUSES).default("NEW"),
    notes: optional(z.string().trim().max(5000)),
  })
  .refine((v) => !v.departureDate || !v.returnDate || v.returnDate >= v.departureDate, {
    path: ["returnDate"],
    message: "Return date must be on or after departure",
  });
export type LeadInput = z.infer<typeof leadSchema>;

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(150),
  phone: optional(phone),
  whatsapp: optional(phone),
  email: optional(z.string().trim().toLowerCase().email("Enter a valid email")),
  dateOfBirth: optional(isoDate),
  address: optional(z.string().trim().max(500)),
  city: optional(z.string().trim().max(100)),
  state: optional(z.string().trim().max(100)),
  country: optional(z.string().trim().max(100)),
  nationality: optional(z.string().trim().max(100)),
  notes: optional(z.string().trim().max(5000)),
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const taskSchema = z.object({
  title: z.string().trim().min(2, "Enter a title").max(200),
  description: optional(z.string().trim().max(2000)),
  kind: z.enum(TASK_KINDS).default("TASK"),
  assignedTo: optional(uuid),
  dueDate: optional(isoDate),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  relatedType: optional(z.enum(["LEAD", "CUSTOMER", "BOOKING"])),
  relatedId: optional(uuid),
});

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const noteSchema = z.object({ body: z.string().trim().min(1, "Write a note").max(5000) });

/** Search text is interpolated into a PostgREST filter, so strip its control characters. */
export function sanitizeSearch(q: string | undefined): string {
  return (q ?? "")
    .replace(/[^\p{L}\p{N} @.+_-]/gu, "")
    .trim()
    .slice(0, 80);
}
