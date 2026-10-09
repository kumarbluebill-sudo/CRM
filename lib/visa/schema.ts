import { z } from "zod";
import { uuid } from "@/lib/crm/schemas";
import {
  APPLICANT_TYPES,
  DELIVERY_METHODS,
  ENTRY_TYPES,
  PRIORITIES,
  VISA_TYPES,
} from "@/lib/visa/constants";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const date = z.preprocess(blank, z.iso.date("Use a valid date.").optional());
const int = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : Number(v)),
    z.number().int().min(min).max(max).optional(),
  );
const money = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(/,/g, ""))) : v),
  z.number().min(0).max(100_000_000).multipleOf(0.01, "Use at most 2 decimals.").optional(),
);
const optId = z.preprocess(blank, uuid.optional());
const nationality = z.string().trim().min(2, "Enter the nationality.").max(100);

export const enquirySchema = z.object({
  customerId: uuid,
  productId: optId,
  countryId: optId,
  nationality: text(100),
  travelDate: date,
  travellers: int(1, 50),
  source: text(100),
  assignedTo: optId,
  priority: z.enum(PRIORITIES).default("NORMAL"),
  followUpDate: date,
  notes: text(5000),
});

export const convertSchema = z.object({
  productId: optId,
  nationality: text(100),
});

export const applicationSchema = z.object({
  customerId: uuid,
  productId: uuid,
  nationality,
  travelDate: date,
  travellers: int(1, 50),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  processorId: optId,
  notes: text(5000),
  enquiryId: optId,
});

export const travellerSchema = z.object({
  first_name: z.string().trim().min(1, "Enter a first name.").max(100),
  middle_name: text(100),
  last_name: text(100),
  date_of_birth: date,
  gender: z.preprocess(blank, z.enum(["MALE", "FEMALE", "OTHER"]).optional()),
  nationality: text(100),
  applicant_type: z.preprocess(blank, z.enum(APPLICANT_TYPES).optional()),
  email: z.preprocess(blank, z.string().trim().email("Enter a valid email.").max(200).optional()),
  mobile: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .regex(/^[+0-9 ()-]{5,20}$/, "Enter a valid mobile number.")
      .optional(),
  ),
  address: text(500),
  occupation: text(150),
  previous_visa: text(1000),
  previous_travel: text(1000),
  passport_number: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/\s/g, "").toUpperCase() : v),
    z.preprocess(
      blank,
      z
        .string()
        .regex(/^[A-Z0-9]{6,12}$/, "Passport numbers are 6-12 letters or digits.")
        .optional(),
    ),
  ),
  passport_issue_date: date,
  passport_expiry_date: date,
  passport_country: text(100),
});

export const countrySchema = z.object({
  name: z.string().trim().min(2).max(100),
  isoCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use the 2-letter country code, e.g. TH."),
  region: text(60),
});

export const documentTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,40}$/, "Use capital letters, digits and underscores."),
  name: z.string().trim().min(2).max(100),
  storageCategory: z.enum(["PASSPORT", "VISA"]).default("VISA"),
});

export const productSchema = z.object({
  countryId: uuid,
  visaType: z.enum(VISA_TYPES),
  entryType: z.enum(ENTRY_TYPES).default("SINGLE"),
  nationality: text(100),
  stayDays: int(1, 3650),
  validityDays: int(1, 7300),
  passportValidityMonths: int(0, 60),
  processingDaysNormal: int(0, 365),
  processingDaysExpress: int(0, 365),
  supplierId: optId,
  source: text(200),
});

export const pricingSchema = z.object({
  serviceFee: money.transform((v) => v ?? 0),
  expressFee: money.transform((v) => v ?? 0),
  markupPercent: z.preprocess((v) => (v === "" ? 0 : Number(v)), z.number().min(0).max(500)),
  gstPercent: z.preprocess((v) => (v === "" ? 18 : Number(v)), z.number().min(0).max(100)),
  governmentFee: money,
  supplierFee: money,
  reason: z.string().trim().min(3, "Say why the price is changing.").max(300),
});

export const requirementSchema = z.object({
  documentTypeId: uuid,
  nationality: text(100),
  applicantType: z.enum(["ALL", "ADULT", "CHILD", "INFANT"]).default("ALL"),
  required: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

export const assignSchema = z.object({
  salesId: optId,
  processorId: optId,
  managerId: optId,
});

export const notesSchema = z.object({
  internalNotes: text(5000),
  customerNotes: text(2000),
  priority: z.enum(PRIORITIES),
  travelDate: date,
});

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const priceSchema = z.object({
  express: checkbox,
  discount: money.transform((v) => v ?? 0),
  reason: text(300),
});

export const submissionSchema = z.object({
  supplierId: optId,
  reference: text(100),
  cost: money,
  notes: text(1000),
});

export const expectedSchema = z.object({ expectedCompletion: date });

export const resultSchema = z.object({
  travellerId: uuid,
  visaNumber: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 /-]{3,40}$/, "Use 3-40 letters, digits, spaces, / or -.")
      .optional(),
  ),
  validFrom: date,
  validUntil: date,
  notes: text(500),
});

export const deliverySchema = z.object({
  method: z.enum(DELIVERY_METHODS),
  confirmation: text(300),
  notes: text(1000),
});

export const visaMessageSchema = z.object({
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  template: z.enum([
    "VISA_DOCUMENT_REQUEST",
    "VISA_CORRECTION",
    "VISA_STATUS_UPDATE",
    "VISA_APPROVED",
    "VISA_READY",
    "GENERAL",
  ]),
  message: text(500),
});
