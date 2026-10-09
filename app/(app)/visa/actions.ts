"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { rateLimit } from "@/lib/rate-limit";
import { deliverCommunication } from "@/lib/comms/deliver";
import { getBranding } from "@/lib/quotation/queries";
import { IMPORT_COLUMNS, parseCsv } from "@/lib/visa/csv-parse";
import { formObject, redirect, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import {
  APPLICATION_STATUSES,
  ENQUIRY_STATUSES,
  REASON_REQUIRED,
  type ApplicationStatus,
} from "@/lib/visa/constants";
import {
  applicationSchema,
  assignSchema,
  convertSchema,
  deliverySchema,
  expectedSchema,
  priceSchema,
  resultSchema,
  submissionSchema,
  visaMessageSchema,
  countrySchema,
  documentTypeSchema,
  enquirySchema,
  notesSchema,
  pricingSchema,
  productSchema,
  requirementSchema,
  travellerSchema,
} from "@/lib/visa/schema";

type DbError = { code?: string; message: string } | null;

/** Turns the database's specific failure codes into sentences staff can act on. */
function throwVisaError(error: DbError, context: string) {
  switch (error?.code) {
    case "P0002":
      throw new AppError("That record wasn't found.", "NOT_FOUND", 404);
    case "P0005":
      throw new AppError(
        "That status change isn't allowed from the current status.",
        "INVALID_TRANSITION",
        409,
      );
    case "P0008":
      throw new AppError("This enquiry has already been converted.", "CONFLICT", 409);
    case "P0009":
      throw new AppError("Please give a reason.", "REASON_REQUIRED", 400);
    case "P0024":
      throw new AppError(
        "That visa product isn't offered for this nationality.",
        "NATIONALITY",
        409,
      );
    case "P0025":
      throw new AppError("This application is closed and can't be changed.", "CLOSED", 409);
    case "P0026":
      throw new AppError("An application needs at least one traveller.", "LAST_TRAVELLER", 409);
    case "P0027":
      throw new AppError(
        "Required documents can't be removed from the checklist.",
        "REQUIRED",
        409,
      );
    case "P0028":
      throw new AppError("Upload the file before reviewing it.", "NO_FILE", 409);
    case "P0029":
      throw new AppError(
        "Every required document must be approved before submission.",
        "DOCS_OPEN",
        409,
      );
    case "P0030":
      throw new AppError(
        "Only new or cancelled applications can be deleted.",
        "NOT_DELETABLE",
        409,
      );
    case "P0031":
      throw new AppError("Express processing isn't offered for this product.", "NO_EXPRESS", 409);
    case "P0032":
      throw new AppError(
        "The price is locked once a quotation has been created.",
        "PRICE_LOCKED",
        409,
      );
    case "P0033":
      throw new AppError("Record the delivery before marking it delivered.", "NO_DELIVERY", 409);
    case "P0034":
      throw new AppError("Price the application first.", "NOT_PRICED", 409);
    case "P0035":
      throw new AppError("This application already has a quotation.", "HAS_QUOTATION", 409);
    case "P0036":
      throw new AppError("Attach the final visa file before delivery.", "NO_RESULT_FILE", 409);
    case "P0014":
      throw new AppError("This customer has asked not to be contacted.", "DO_NOT_CONTACT", 409);
    case "P0015":
      throw new AppError(
        "The customer has no email or phone number for that channel.",
        "NO_ADDRESS",
        409,
      );
    case "23505":
      throw new AppError("That already exists.", "DUPLICATE", 409);
    case "22023":
      throw new AppError("Some values are invalid. Please check the form.", "INVALID_VALUE", 400);
  }
  throwIfDbError(error, context);
}

const appPath = (id: string) => `/visa/applications/${id}`;
const bad = (parsed: {
  success: false;
  error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } };
}) =>
  ({
    fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
  }) satisfies FormState;

async function guard(permission: Parameters<typeof requirePermission>[0], key: string, limit = 60) {
  const session = await requirePermission(permission);
  if (!(await rateLimit(`${key}:${session.userId}`, limit, 60_000)).allowed)
    throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
  return session;
}

/* ---------------- enquiries ---------------- */

export async function createEnquiryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = enquirySchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  const v = parsed.data;
  let id = "";
  const result = await runAction(async () => {
    await guard("visa.create", "visa-enq");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_visa_enquiry", {
      p_customer: v.customerId,
      p_country: v.countryId ?? null,
      p_product: v.productId ?? null,
      p_nationality: v.nationality ?? null,
      p_travel_date: v.travelDate ?? null,
      p_travellers: v.travellers ?? 1,
      p_source: v.source ?? null,
      p_assigned: v.assignedTo ?? null,
      p_priority: v.priority,
      p_notes: v.notes ?? null,
      p_follow_up: v.followUpDate ?? null,
    });
    throwVisaError(error, "create visa enquiry");
    id = data as string;
    revalidatePath("/visa/enquiries");
  });
  if (result.message) return result;
  redirect(`/visa/enquiries/${id}`);
}

export async function setEnquiryStatusAction(
  id: string,
  status: string,
  reason?: string,
): Promise<FormState> {
  const next = ENQUIRY_STATUSES.find((s) => s === status);
  if (!uuid.safeParse(id).success || !next) return { message: "Invalid request." };
  return runAction(async () => {
    await guard("visa.edit", "visa-enq-status");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_visa_enquiry_status", {
      p_id: id,
      p_status: next,
      p_reason: reason?.slice(0, 500) ?? null,
    });
    throwVisaError(error, "set enquiry status");
    revalidatePath(`/visa/enquiries/${id}`);
    revalidatePath("/visa/enquiries");
    return { ok: true, message: "Status updated." };
  });
}

export async function convertEnquiryAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Enquiry not found." };
  const parsed = convertSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  let appId = "";
  const result = await runAction(async () => {
    await guard("visa.create", "visa-convert", 30);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("convert_enquiry_to_application", {
      p_enquiry: id,
      p_product: parsed.data.productId ?? null,
      p_nationality: parsed.data.nationality ?? null,
    });
    throwVisaError(error, "convert visa enquiry");
    appId = data as string;
    revalidatePath("/visa/enquiries");
    revalidatePath("/visa/applications");
  });
  if (result.message) return result;
  redirect(appPath(appId));
}

/* ---------------- applications ---------------- */

export async function createApplicationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = applicationSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  const v = parsed.data;
  let id = "";
  const result = await runAction(async () => {
    await guard("visa.create", "visa-app", 30);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_visa_application", {
      p_customer: v.customerId,
      p_product: v.productId,
      p_nationality: v.nationality,
      p_travel_date: v.travelDate ?? null,
      p_travellers: v.travellers ?? 1,
      p_enquiry: v.enquiryId ?? null,
      p_priority: v.priority,
      p_sales: null,
      p_processor: v.processorId ?? null,
      p_notes: v.notes ?? null,
    });
    throwVisaError(error, "create visa application");
    id = data as string;
    revalidatePath("/visa/applications");
  });
  if (result.message) return result;
  redirect(appPath(id));
}

export async function setApplicationStatusAction(
  id: string,
  status: string,
  reason?: string,
): Promise<FormState> {
  const next = APPLICATION_STATUSES.find((s) => s === status) as ApplicationStatus | undefined;
  if (!uuid.safeParse(id).success || !next) return { message: "Invalid request." };
  if (REASON_REQUIRED.includes(next) && !reason?.trim())
    return { message: "Please give a reason." };
  return runAction(async () => {
    await guard("visa.process", "visa-status");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_visa_status", {
      p_id: id,
      p_status: next,
      p_reason: reason?.slice(0, 500) ?? null,
    });
    throwVisaError(error, "set visa status");
    revalidatePath(appPath(id));
    revalidatePath("/visa/applications");
    revalidatePath("/visa");
    return { ok: true, message: "Status updated." };
  });
}

export async function assignApplicationAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Application not found." };
  const parsed = assignSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  return runAction(async () => {
    await guard("visa.application.assign", "visa-assign");
    const supabase = await createClient();
    const { error } = await supabase.rpc("assign_visa_application", {
      p_id: id,
      p_sales: parsed.data.salesId ?? null,
      p_processor: parsed.data.processorId ?? null,
      p_manager: parsed.data.managerId ?? null,
    });
    throwVisaError(error, "assign visa application");
    revalidatePath(appPath(id));
    return { ok: true, message: "Assignment saved." };
  });
}

export async function updateApplicationNotesAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Application not found." };
  const parsed = notesSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  return runAction(async () => {
    await guard("visa.edit", "visa-notes");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("visa_applications")
      .update({
        internal_notes: parsed.data.internalNotes ?? null,
        customer_notes: parsed.data.customerNotes ?? null,
        priority: parsed.data.priority,
        travel_date: parsed.data.travelDate ?? null,
      })
      .eq("id", id)
      .select("id");
    throwVisaError(error, "update visa notes");
    if (!data?.length) throw new AppError("Application not found.", "NOT_FOUND", 404);
    revalidatePath(appPath(id));
    return { ok: true, message: "Saved." };
  });
}

export async function deleteApplicationAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Invalid request." };
  let ok = false;
  const result = await runAction(async () => {
    await guard("visa.delete", "visa-delete", 10);
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_visa_application", { p_id: id });
    throwVisaError(error, "delete visa application");
    revalidatePath("/visa/applications");
    ok = true;
  });
  if (!ok) return result;
  redirect("/visa/applications");
}

/* ---------------- travellers ---------------- */

export async function addTravellerAction(
  applicationId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(applicationId).success) return { message: "Application not found." };
  const parsed = travellerSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  return runAction(async () => {
    await guard("visa.edit", "visa-trav");
    const supabase = await createClient();
    const { error } = await supabase.rpc("add_visa_traveller", {
      p_application: applicationId,
      p_data: compact(parsed.data),
    });
    throwVisaError(error, "add visa traveller");
    revalidatePath(appPath(applicationId));
    return { ok: true, message: "Traveller added and checklist updated." };
  });
}

export async function updateTravellerAction(
  applicationId: string,
  travellerId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(applicationId).success || !uuid.safeParse(travellerId).success)
    return { message: "Not found." };
  const parsed = travellerSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  return runAction(async () => {
    await guard("visa.edit", "visa-trav");
    const supabase = await createClient();
    // Empty fields are sent as "" so clearing a value works; the function treats "" as null.
    const { error } = await supabase.rpc("update_visa_traveller", {
      p_id: travellerId,
      p_data: fill(parsed.data),
    });
    throwVisaError(error, "update visa traveller");
    revalidatePath(appPath(applicationId));
    return { ok: true, message: "Traveller saved." };
  });
}

export async function removeTravellerAction(
  applicationId: string,
  travellerId: string,
): Promise<FormState> {
  if (!uuid.safeParse(applicationId).success || !uuid.safeParse(travellerId).success)
    return { message: "Not found." };
  return runAction(async () => {
    await guard("visa.edit", "visa-trav");
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_visa_traveller", { p_id: travellerId });
    throwVisaError(error, "remove visa traveller");
    revalidatePath(appPath(applicationId));
    return { ok: true, message: "Traveller removed." };
  });
}

/** Only the values the user filled in. */
function compact(v: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(v).filter(([, x]) => x !== undefined && x !== null && x !== ""),
  );
}
/** Every field, with "" for cleared ones, so an edit can blank a value. */
function fill(v: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x ?? ""]));
}

/* ---------------- checklist and review ---------------- */

export async function requestDocumentAction(
  applicationId: string,
  itemId: string,
  note?: string,
): Promise<FormState> {
  if (!uuid.safeParse(applicationId).success || !uuid.safeParse(itemId).success)
    return { message: "Not found." };
  return runAction(async () => {
    await guard("visa.edit", "visa-doc");
    const supabase = await createClient();
    const { error } = await supabase.rpc("request_visa_document", {
      p_item: itemId,
      p_note: note?.slice(0, 500) ?? null,
    });
    throwVisaError(error, "request visa document");
    revalidatePath(appPath(applicationId));
    return { ok: true, message: "Marked as requested." };
  });
}

export async function addChecklistItemAction(
  applicationId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(applicationId).success) return { message: "Application not found." };
  const name = String(formData.get("name") ?? "").trim();
  const traveller = String(formData.get("travellerId") ?? "");
  if (name.length < 1 || name.length > 150)
    return { fieldErrors: { name: ["Enter a document name."] } };
  return runAction(async () => {
    await guard("visa.edit", "visa-doc");
    const supabase = await createClient();
    const { error } = await supabase.rpc("add_visa_checklist_item", {
      p_application: applicationId,
      p_traveller: uuid.safeParse(traveller).success ? traveller : null,
      p_name: name,
      p_required: formData.get("required") === "on",
    });
    throwVisaError(error, "add checklist item");
    revalidatePath(appPath(applicationId));
    return { ok: true, message: "Added to the checklist." };
  });
}

export async function removeChecklistItemAction(
  applicationId: string,
  itemId: string,
): Promise<FormState> {
  if (!uuid.safeParse(applicationId).success || !uuid.safeParse(itemId).success)
    return { message: "Not found." };
  return runAction(async () => {
    await guard("visa.edit", "visa-doc");
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_visa_checklist_item", { p_item: itemId });
    throwVisaError(error, "remove checklist item");
    revalidatePath(appPath(applicationId));
    return { ok: true, message: "Removed." };
  });
}

const DECISIONS = ["APPROVED", "REJECTED", "CORRECTION_REQUIRED", "UNDER_REVIEW"] as const;

export async function reviewDocumentAction(
  applicationId: string,
  itemId: string,
  decision: string,
  note?: string,
): Promise<FormState> {
  const d = DECISIONS.find((x) => x === decision);
  if (!uuid.safeParse(applicationId).success || !uuid.safeParse(itemId).success || !d)
    return { message: "Invalid request." };
  if ((d === "REJECTED" || d === "CORRECTION_REQUIRED") && (note ?? "").trim().length < 3)
    return { message: "Please give a reason." };
  return runAction(async () => {
    await guard(
      d === "APPROVED" || d === "UNDER_REVIEW" ? "visa.document.approve" : "visa.document.reject",
      "visa-review",
    );
    const supabase = await createClient();
    const { error } = await supabase.rpc("review_visa_document", {
      p_item: itemId,
      p_decision: d,
      p_note: note?.slice(0, 500) ?? null,
    });
    throwVisaError(error, "review visa document");
    revalidatePath(appPath(applicationId));
    revalidatePath("/visa");
    return { ok: true, message: d === "APPROVED" ? "Document approved." : "Review saved." };
  });
}

/* ---------------- master data ---------------- */

export async function createCountryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = countrySchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  return runAction(async () => {
    await guard("visa.price.edit", "visa-master");
    const supabase = await createClient();
    const { error } = await supabase.from("visa_countries").insert({
      name: parsed.data.name,
      iso_code: parsed.data.isoCode,
      region: parsed.data.region ?? null,
    });
    throwVisaError(error, "create visa country");
    revalidatePath("/visa/settings");
    return { ok: true, message: "Country added." };
  });
}

export async function setCountryActiveAction(id: string, active: boolean): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Not found." };
  return runAction(async () => {
    await guard("visa.price.edit", "visa-master");
    const supabase = await createClient();
    const { error } = await supabase.from("visa_countries").update({ active }).eq("id", id);
    throwVisaError(error, "toggle visa country");
    revalidatePath("/visa/settings");
    return { ok: true, message: active ? "Country enabled." : "Country disabled." };
  });
}

export async function createDocumentTypeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = documentTypeSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  return runAction(async () => {
    await guard("visa.price.edit", "visa-master");
    const supabase = await createClient();
    const { error } = await supabase.from("visa_document_types").insert({
      code: parsed.data.code,
      name: parsed.data.name,
      storage_category: parsed.data.storageCategory,
    });
    throwVisaError(error, "create visa document type");
    revalidatePath("/visa/settings");
    return { ok: true, message: "Document type added." };
  });
}

export async function createProductAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = productSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  const v = parsed.data;
  let id = "";
  const result = await runAction(async () => {
    const session = await guard("visa.price.edit", "visa-master");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("visa_products")
      .insert({
        country_id: v.countryId,
        visa_type: v.visaType,
        entry_type: v.entryType,
        nationality: v.nationality ?? null,
        stay_days: v.stayDays ?? null,
        validity_days: v.validityDays ?? null,
        passport_validity_months: v.passportValidityMonths ?? 6,
        processing_days_normal: v.processingDaysNormal ?? null,
        processing_days_express: v.processingDaysExpress ?? null,
        supplier_id: v.supplierId ?? null,
        source: v.source ?? null,
        created_by: session.userId,
        updated_by: session.userId,
      })
      .select("id")
      .single();
    throwVisaError(error, "create visa product");
    id = data!.id as string;
    revalidatePath("/visa/products");
  });
  if (result.message) return result;
  redirect(`/visa/products/${id}`);
}

export async function updateProductAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Product not found." };
  const parsed = productSchema.safeParse({
    ...formObject(formData),
    countryId: "00000000-0000-4000-8000-000000000000",
  });
  if (!parsed.success) return bad(parsed);
  const v = parsed.data;
  return runAction(async () => {
    const session = await guard("visa.price.edit", "visa-master");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("visa_products")
      .update({
        visa_type: v.visaType,
        entry_type: v.entryType,
        nationality: v.nationality ?? null,
        stay_days: v.stayDays ?? null,
        validity_days: v.validityDays ?? null,
        passport_validity_months: v.passportValidityMonths ?? 6,
        processing_days_normal: v.processingDaysNormal ?? null,
        processing_days_express: v.processingDaysExpress ?? null,
        supplier_id: v.supplierId ?? null,
        source: v.source ?? null,
        active: formData.get("active") === "on",
        updated_by: session.userId,
      })
      .eq("id", id)
      .select("id");
    throwVisaError(error, "update visa product");
    if (!data?.length) throw new AppError("Product not found.", "NOT_FOUND", 404);
    revalidatePath(`/visa/products/${id}`);
    return { ok: true, message: "Product saved." };
  });
}

export async function updatePricingAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Product not found." };
  const parsed = pricingSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  const v = parsed.data;
  return runAction(async () => {
    await guard("visa.price.edit", "visa-price", 20);
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_visa_pricing", {
      p_product: id,
      p_service_fee: v.serviceFee,
      p_express_fee: v.expressFee,
      p_markup: v.markupPercent,
      p_gst: v.gstPercent,
      p_government_fee: v.governmentFee ?? null,
      p_supplier_fee: v.supplierFee ?? null,
      p_reason: v.reason,
    });
    throwVisaError(error, "update visa pricing");
    revalidatePath(`/visa/products/${id}`);
    revalidatePath("/visa/products");
    return { ok: true, message: "Pricing updated and recorded in the price history." };
  });
}

export async function addRequirementAction(
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(productId).success) return { message: "Product not found." };
  const parsed = requirementSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  return runAction(async () => {
    await guard("visa.price.edit", "visa-master");
    const supabase = await createClient();
    const { error } = await supabase.from("visa_requirements").insert({
      product_id: productId,
      document_type_id: parsed.data.documentTypeId,
      nationality: parsed.data.nationality ?? null,
      applicant_type: parsed.data.applicantType,
      required: parsed.data.required,
    });
    throwVisaError(error, "add visa requirement");
    revalidatePath(`/visa/products/${productId}`);
    return { ok: true, message: "Requirement added. New applications will include it." };
  });
}

export async function removeRequirementAction(productId: string, id: string): Promise<FormState> {
  if (!uuid.safeParse(productId).success || !uuid.safeParse(id).success)
    return { message: "Not found." };
  return runAction(async () => {
    await guard("visa.price.edit", "visa-master");
    const supabase = await createClient();
    const { error } = await supabase
      .from("visa_requirements")
      .delete()
      .eq("id", id)
      .eq("product_id", productId);
    throwVisaError(error, "remove visa requirement");
    revalidatePath(`/visa/products/${productId}`);
    return { ok: true, message: "Requirement removed." };
  });
}

/* ---------------- commerce: pricing, quotation, supplier, results, delivery, messages ---------------- */

export async function priceApplicationAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Application not found." };
  const parsed = priceSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  const v = parsed.data;
  return runAction(async () => {
    await guard("visa.edit", "visa-price-app", 30);
    const supabase = await createClient();
    const { error } = await supabase.rpc("price_visa_application", {
      p_app: id,
      p_express: v.express,
      p_discount: v.discount,
      p_reason: v.reason ?? null,
    });
    throwVisaError(error, "price visa application");
    revalidatePath(appPath(id));
    return { ok: true, message: "Price calculated and saved." };
  });
}

export async function createVisaQuotationAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Application not found." };
  return runAction(async () => {
    await guard("visa.edit", "visa-quote", 20);
    const supabase = await createClient();
    const { error } = await supabase.rpc("create_visa_quotation", { p_app: id });
    throwVisaError(error, "create visa quotation");
    revalidatePath(appPath(id));
    revalidatePath("/quotations");
    return { ok: true, message: "Quotation created. Open it to review and send." };
  });
}

export async function recordSubmissionAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Application not found." };
  const parsed = submissionSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  const v = parsed.data;
  return runAction(async () => {
    await guard("visa.application.submit", "visa-submission", 30);
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_supplier_submission", {
      p_app: id,
      p_supplier: v.supplierId ?? null,
      p_reference: v.reference ?? null,
      p_cost: v.cost ?? null,
      p_notes: v.notes ?? null,
    });
    throwVisaError(error, "record supplier submission");
    revalidatePath(appPath(id));
    return { ok: true, message: "Supplier submission recorded." };
  });
}

export async function setExpectedCompletionAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Application not found." };
  const parsed = expectedSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  return runAction(async () => {
    await guard("visa.process", "visa-expected", 30);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_visa_expected_completion", {
      p_app: id,
      p_date: parsed.data.expectedCompletion ?? null,
    });
    throwVisaError(error, "set expected completion");
    revalidatePath(appPath(id));
    revalidatePath("/visa/queue");
    return { ok: true, message: "Expected completion saved." };
  });
}

export async function recordResultAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Application not found." };
  const parsed = resultSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  const v = parsed.data;
  return runAction(async () => {
    await guard("visa.process", "visa-result", 30);
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_visa_result", {
      p_app: id,
      p_traveller: v.travellerId,
      p_document: null,
      p_visa_number: v.visaNumber ?? null,
      p_valid_from: v.validFrom ?? null,
      p_valid_until: v.validUntil ?? null,
      p_notes: v.notes ?? null,
    });
    throwVisaError(error, "record visa result");
    revalidatePath(appPath(id));
    return { ok: true, message: "Visa details saved." };
  });
}

export async function recordDeliveryAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Application not found." };
  const parsed = deliverySchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  const v = parsed.data;
  return runAction(async () => {
    await guard("visa.process", "visa-delivery", 30);
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_visa_delivery", {
      p_app: id,
      p_method: v.method,
      p_confirmation: v.confirmation ?? null,
      p_notes: v.notes ?? null,
    });
    throwVisaError(error, "record visa delivery");
    revalidatePath(appPath(id));
    revalidatePath("/visa");
    revalidatePath("/visa/queue");
    return { ok: true, message: "Delivery recorded." };
  });
}

type SendState = FormState & { waUrl?: string };

/** Queues and sends a customer message about an application. Variables come from the database, not the browser. */
export async function sendVisaMessageAction(
  id: string,
  _prev: SendState,
  formData: FormData,
): Promise<SendState> {
  if (!uuid.safeParse(id).success) return { message: "Application not found." };
  const parsed = visaMessageSchema.safeParse(formObject(formData));
  if (!parsed.success) return bad(parsed);
  const v = parsed.data;
  try {
    const session = await guard("communications.send", "visa-message", 30);
    const supabase = await createClient();
    const { data: a } = await supabase
      .from("visa_applications")
      .select(
        "application_number, visa_type, expected_completion, customers ( name ), visa_countries ( name )",
      )
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!a) throw new AppError("Application not found.", "NOT_FOUND", 404);
    const { data: open } = await supabase
      .from("visa_application_documents")
      .select("name, status")
      .eq("application_id", id)
      .eq("required", true)
      .in("status", ["PENDING", "REQUESTED", "REJECTED", "CORRECTION_REQUIRED", "EXPIRED"]);
    const customer = a.customers as unknown as { name: string } | null;
    const country = a.visa_countries as unknown as { name: string } | null;
    const vars: Record<string, string> = {
      customer_name: customer?.name ?? "",
      application_number: a.application_number as string,
      country: country?.name ?? "",
      visa_type: String(a.visa_type).toLowerCase(),
      documents_pending:
        (open ?? []).map((d) => d.name as string).join(", ") || "nothing outstanding",
      expected_completion: (a.expected_completion as string | null) ?? "to be confirmed",
      message: v.message ?? "",
    };
    const { data: cid, error } = await supabase.rpc("queue_visa_communication", {
      p_channel: v.channel,
      p_template: v.template,
      p_app: id,
      p_vars: vars,
    });
    throwVisaError(error, "queue visa message");
    const branding = await getBranding();
    const result = await deliverCommunication(
      supabase,
      cid as string,
      session.organization?.name ?? "Your travel agency",
      branding?.email ?? null,
    );
    revalidatePath(appPath(id));
    revalidatePath("/communications");
    return { ok: result.status === "SENT", message: result.message, waUrl: result.waUrl };
  } catch (error) {
    if (error instanceof AppError) return { message: error.message };
    return { message: "Something went wrong. Please try again." };
  }
}

/* ---------------- master-data import ---------------- */

export type ImportPreview = FormState & {
  rows?: { row: number; status: string; message: string | null }[];
  summary?: Record<string, number>;
};

async function runImport(kind: string, csv: string, commit: boolean): Promise<ImportPreview> {
  if (kind !== "countries" && kind !== "products") return { message: "Choose what to import." };
  const parsed = parseCsv(csv, IMPORT_COLUMNS[kind]);
  if (parsed.error) return { message: parsed.error };
  return runAction(async () => {
    await guard("visa.price.edit", "visa-import", commit ? 10 : 30);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("import_visa_master", {
      p_kind: kind,
      p_rows: parsed.rows,
      p_commit: commit,
    });
    throwVisaError(error, "import visa master data");
    const rows = (data ?? []) as { row: number; status: string; message: string | null }[];
    const summary: Record<string, number> = {};
    for (const r of rows) summary[r.status] = (summary[r.status] ?? 0) + 1;
    if (commit) {
      revalidatePath("/visa/products");
      revalidatePath("/visa/settings");
    }
    return { ok: true, rows, summary } as ImportPreview;
  });
}

export async function previewImportAction(kind: string, csv: string): Promise<ImportPreview> {
  return runImport(kind, csv, false);
}

export async function commitImportAction(kind: string, csv: string): Promise<ImportPreview> {
  const result = await runImport(kind, csv, true);
  if (result.ok)
    result.message = `Imported ${result.summary?.IMPORTED ?? 0} row(s). Nothing existing was changed.`;
  return result;
}
