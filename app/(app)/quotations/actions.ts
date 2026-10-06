"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { formObject, redirect, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { quotationDocSchema, QUOTATION_STATUSES } from "@/lib/quotation/schema";

type DbError = { code?: string; message: string } | null;

/** Maps the quotation SQL functions' error codes to friendly, safe messages. */
function throwQuotationError(error: DbError, context: string) {
  switch (error?.code) {
    case "40001":
      throw new AppError(
        "Someone else changed this quotation. Reload the page to get the latest version.",
        "CONFLICT",
        409,
      );
    case "P0004":
      throw new AppError(
        "This quotation has been sent and is locked. Move it to negotiation to edit it.",
        "LOCKED",
        409,
      );
    case "P0005":
      throw new AppError(
        "That status change isn't allowed from the current status.",
        "INVALID_TRANSITION",
        409,
      );
    case "P0006":
      throw new AppError(
        error.message.includes("select")
          ? "Select an option first."
          : "Add at least one line item first.",
        "INCOMPLETE",
        409,
      );
    case "P0002":
      throw new AppError("Quotation, customer or linked record not found.", "NOT_FOUND", 404);
    case "22023":
      throw new AppError(
        "The quotation has invalid or too many options or items.",
        "INVALID_VALUE",
      );
  }
  throwIfDbError(error, context);
}

const optional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), s.optional());
const createSchema = z.object({
  customerId: uuid,
  title: z.string().trim().min(2, "Enter a title").max(200),
  leadId: optional(uuid),
  itineraryId: optional(uuid),
  templateId: optional(uuid),
  currency: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().length(3).toUpperCase().default("INR"),
  ),
});

export async function createQuotationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  let newId = "";
  const result = await runAction(async () => {
    await requirePermission("quotes.create");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_quotation", {
      p_customer: v.customerId,
      p_title: v.title,
      p_lead: v.leadId ?? null,
      p_itinerary: v.itineraryId ?? null,
      p_template: v.templateId ?? null,
      p_currency: v.currency,
    });
    throwQuotationError(error, "create quotation");
    newId = data as string;
    revalidatePath("/quotations");
  });
  if (result.message) return result;
  redirect(`/quotations/${newId}`);
}

export async function saveQuotationAction(
  id: string,
  expectedVersion: number,
  payload: unknown,
  options: { snapshot?: boolean; label?: string } = {},
): Promise<{ ok: boolean; message?: string; version?: number; problems?: string[] }> {
  if (!uuid.safeParse(id).success || !Number.isInteger(expectedVersion))
    return { ok: false, message: "Invalid request." };
  const parsed = quotationDocSchema.safeParse(payload);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join(" › ") || "form"}: ${i.message}`)
      .slice(0, 8);
    return { ok: false, message: "Please fix the highlighted problems.", problems };
  }
  let version = 0;
  const res = await runAction(async () => {
    const session = await requirePermission("quotes.update");
    // Defence in depth: the database ignores costs from users without quotes.view_cost, and we
    // also strip them here so they never reach the function.
    const mayCost = session.permissions.has("quotes.view_cost");
    const data = mayCost
      ? parsed.data
      : {
          ...parsed.data,
          options: parsed.data.options.map((o) => ({
            ...o,
            items: o.items.map((i) => ({ ...i, unitCost: null, markupPercent: null })),
          })),
        };
    const supabase = await createClient();
    const { data: v, error } = await supabase.rpc("save_quotation", {
      p_id: id,
      p_data: data,
      p_expected_version: expectedVersion,
      p_snapshot: options.snapshot ?? false,
      p_label: options.label?.slice(0, 100) ?? null,
    });
    throwQuotationError(error, "save quotation");
    version = v as number;
    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
  });
  return res.message ? { ok: false, message: res.message } : { ok: true, version };
}

export async function setQuotationStatusAction(id: string, status: string): Promise<FormState> {
  const next = QUOTATION_STATUSES.find((s) => s === status);
  if (!uuid.safeParse(id).success || !next) return { message: "Invalid request." };
  return runAction(async () => {
    await requirePermission(next === "SENT" ? "quotes.send" : "quotes.update");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_quotation_status", { p_id: id, p_status: next });
    throwQuotationError(error, "set status");
    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
    return { ok: true, message: "Status updated." };
  });
}

export async function deleteQuotationAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Quotation not found." };
  const result = await runAction(async () => {
    await requirePermission("quotes.delete");
    const supabase = await createClient();
    const { data: q } = await supabase
      .from("quotations")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (!q) throw new AppError("Quotation not found.", "NOT_FOUND", 404);
    if (!["DRAFT", "EXPIRED", "REJECTED"].includes(q.status as string)) {
      throw new AppError(
        "Only draft, expired or rejected quotations can be deleted.",
        "LOCKED",
        409,
      );
    }
    const { error } = await supabase.from("quotations").delete().eq("id", id);
    throwQuotationError(error, "delete quotation");
    revalidatePath("/quotations");
  });
  if (result.message) return result;
  redirect("/quotations");
}

/* ---------------- templates ---------------- */

const templateSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(120),
  intro: optional(z.string().trim().max(3000)),
  terms: optional(z.string().trim().max(10000)),
  cancellationPolicy: optional(z.string().trim().max(5000)),
  paymentTerms: optional(z.string().trim().max(3000)),
});

function templateColumns(v: z.infer<typeof templateSchema>) {
  return {
    name: v.name,
    intro: v.intro ?? null,
    terms: v.terms ?? null,
    cancellation_policy: v.cancellationPolicy ?? null,
    payment_terms: v.paymentTerms ?? null,
  };
}

export async function saveTemplateAction(
  id: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = templateSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  if (id !== null && !uuid.safeParse(id).success) return { message: "Template not found." };
  const result = await runAction(async () => {
    await requirePermission("quotes.update");
    const supabase = await createClient();
    const cols = templateColumns(parsed.data);
    const { error } = id
      ? await supabase.from("quotation_templates").update(cols).eq("id", id)
      : await supabase.from("quotation_templates").insert(cols);
    if (error?.code === "23505")
      throw new AppError("A template with that name already exists.", "DUPLICATE");
    throwQuotationError(error, "save template");
    revalidatePath("/quotations/templates");
  });
  if (result.message) return result;
  redirect("/quotations/templates");
}

export async function deleteTemplateAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Template not found." };
  const result = await runAction(async () => {
    await requirePermission("quotes.delete");
    const supabase = await createClient();
    const { error } = await supabase.from("quotation_templates").delete().eq("id", id);
    throwQuotationError(error, "delete template");
    revalidatePath("/quotations/templates");
  });
  if (result.message) return result;
  redirect("/quotations/templates");
}
