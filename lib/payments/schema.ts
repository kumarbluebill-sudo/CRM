import { z } from "zod";
import { uuid } from "@/lib/crm/schemas";

export const MANUAL_METHODS = ["CASH", "BANK_TRANSFER", "UPI", "CARD", "CHEQUE", "OTHER"] as const;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const money = z.preprocess(
  (v) => (typeof v === "string" ? Number(v.replace(/,/g, "")) : v),
  z
    .number()
    .positive("Enter an amount above zero.")
    .max(1_000_000_000)
    .multipleOf(0.01, "Use at most 2 decimals."),
);
const optionalDate = z.preprocess(blank, z.iso.date().optional());

export const manualPaymentSchema = z.object({
  amount: money,
  method: z.enum(MANUAL_METHODS),
  reference: optionalText(100),
  paidAt: optionalDate,
  notes: optionalText(1000),
});

export const scheduleSchema = z.object({
  label: z.string().trim().min(1, "Enter a label.").max(100),
  dueDate: z.iso.date("Pick a due date."),
  amount: money,
});

export const onlinePaymentSchema = z.object({ bookingId: uuid, amount: money });

export const invoiceSchema = z.object({
  dueDate: optionalDate,
  notes: optionalText(1000),
});
