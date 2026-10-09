import { z } from "zod";
import { uuid } from "@/lib/crm/schemas";
import { JOB_PRIORITIES, RELATED_TYPES } from "@/lib/jobs/constants";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const date = z.preprocess(blank, z.iso.date("Use a valid date.").optional());
const optId = z.preprocess(blank, uuid.optional());

export const jobSchema = z
  .object({
    title: z.string().trim().min(3, "Give the job a short title.").max(200),
    instructions: text(5000),
    customerId: optId,
    relatedType: z.preprocess(
      blank,
      z.enum(RELATED_TYPES.map((r) => r.value) as [string, ...string[]]).optional(),
    ),
    relatedId: optId,
    assignedTo: optId,
    assignedTeam: text(80),
    priority: z.enum(JOB_PRIORITIES).default("NORMAL"),
    startDate: date,
    deadline: date,
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.relatedType) !== Boolean(v.relatedId))
      ctx.addIssue({
        code: "custom",
        path: ["relatedId"],
        message: "Choose both the record type and the record.",
      });
    if (v.startDate && v.deadline && v.deadline < v.startDate)
      ctx.addIssue({
        code: "custom",
        path: ["deadline"],
        message: "The deadline can't be before the start date.",
      });
  });

export const staffSchema = z.object({
  employeeCode: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,20}$/, "Use up to 20 letters, digits, . _ or -")
      .optional(),
  ),
  designation: text(60),
  department: text(60),
  phone: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .regex(/^[+0-9 ()-]{5,20}$/, "Enter a valid phone number.")
      .optional(),
  ),
  reportingManagerId: optId,
  active: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});
