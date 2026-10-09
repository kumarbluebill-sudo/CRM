import { z } from "zod";
import { gstinValid } from "@/lib/gst/gstin";
import { gstStateCodes } from "@/lib/invoicing/state-codes";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const upper = (v: unknown) => (typeof v === "string" ? v.replace(/\s/g, "").toUpperCase() : v);
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
const gstin = z.preprocess(
  (v) => blank(upper(v)),
  z.string().refine(gstinValid, "That GSTIN isn't valid. Check every character.").optional(),
);

export const taxProfileSchema = z
  .object({
    gstRegistered: checkbox,
    gstin,
    legalName: z.string().trim().min(2, "Enter the legal business name.").max(200),
    tradeName: text(200),
    address: z.string().trim().min(5, "Enter the registered address.").max(500),
    stateCode: z
      .string()
      .regex(/^[0-9]{2}$/, "Choose the state.")
      .refine((c) => gstStateCodes.has(c), "Choose the state."),
    pan: z.preprocess(
      (v) => blank(upper(v)),
      z
        .string()
        .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN looks like ABCDE1234F.")
        .optional(),
    ),
    invoicePrefix: z.preprocess(
      (v) => blank(upper(v)) ?? "INV",
      z.string().regex(/^[A-Z0-9]{1,5}$/, "Use 1-5 letters or digits."),
    ),
    pricesIncludeTax: checkbox,
    roundOff: checkbox,
    bankName: text(100),
    bankAccountName: text(100),
    bankAccountNo: z.preprocess(
      (v) => blank(upper(v)),
      z
        .string()
        .regex(/^[0-9A-Z]{6,20}$/, "Enter 6-20 letters or digits.")
        .optional(),
    ),
    bankIfsc: z.preprocess(
      (v) => blank(upper(v)),
      z
        .string()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC looks like HDFC0001234.")
        .optional(),
    ),
    upiId: z.preprocess(
      blank,
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._-]{2,60}@[A-Za-z0-9.-]{2,30}$/, "UPI ID looks like name@bank.")
        .optional(),
    ),
    terms: text(3000),
  })
  .superRefine((v, ctx) => {
    if (v.gstRegistered) {
      if (!v.gstin)
        ctx.addIssue({
          code: "custom",
          path: ["gstin"],
          message: "Enter the GSTIN of a GST-registered agency.",
        });
      else if (v.gstin.slice(0, 2) !== v.stateCode)
        ctx.addIssue({
          code: "custom",
          path: ["stateCode"],
          message: "The state must match the first two digits of the GSTIN.",
        });
    }
  });

export const taxCodeSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a name.").max(100),
    sacCode: z.preprocess(
      blank,
      z
        .string()
        .trim()
        .regex(/^[0-9]{4,8}$/, "A SAC code has 4-8 digits.")
        .optional(),
    ),
    treatment: z.enum(["TAXABLE", "EXEMPT", "ZERO_RATED", "NIL_RATED"]),
    rate: z.preprocess(
      (v) => (v === "" || v === undefined ? 0 : Number(v)),
      z.number().min(0).max(100),
    ),
    active: checkbox,
  })
  .superRefine((v, ctx) => {
    if (v.treatment === "TAXABLE" && v.rate <= 0)
      ctx.addIssue({
        code: "custom",
        path: ["rate"],
        message: "A taxable code needs a rate above 0.",
      });
    if (v.treatment !== "TAXABLE" && v.rate !== 0)
      ctx.addIssue({
        code: "custom",
        path: ["rate"],
        message: "Exempt, zero-rated and nil-rated codes must have a 0% rate.",
      });
  });

export const invoiceDraftSchema = z.object({
  dueDate: z.preprocess(blank, z.iso.date("Use a valid date.").optional()),
  notes: text(1000),
  terms: text(3000),
  placeOfSupply: z.preprocess(
    blank,
    z
      .string()
      .regex(/^[0-9]{2}$/)
      .optional(),
  ),
  customerGstin: gstin,
  billName: text(200),
  billAddress: text(500),
  priceIncludesTax: checkbox,
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1, "Describe every line.").max(500),
        taxCodeId: z.preprocess(blank, z.string().uuid().optional()),
        quantity: z.coerce.number().positive("Quantity must be above 0.").max(100000),
        unitPrice: z.coerce.number().min(0).max(100_000_000),
        discount: z.coerce.number().min(0).max(100_000_000).default(0),
      }),
    )
    .min(1, "Add at least one line.")
    .max(100),
});

export const creditNoteSchema = z.object({
  reason: z.string().trim().min(3, "Say why the invoice is being credited.").max(500),
});
