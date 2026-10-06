"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { formObject, redirect, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { supplierContactSchema, supplierSchema, supplierServiceSchema } from "@/lib/booking/schema";

function dbError(error: { code?: string; message: string } | null, context: string) {
  if (error?.code === "23505")
    throw new AppError("A supplier with that name and type already exists.", "DUPLICATE", 409);
  if (error?.code === "23503")
    throw new AppError(
      "This supplier is used by a booking and can't be deleted. Mark it inactive instead.",
      "IN_USE",
      409,
    );
  throwIfDbError(error, context);
}

const supplierColumns = (v: ReturnType<typeof supplierSchema.parse>) => ({
  type: v.type,
  company_name: v.companyName,
  contact_name: v.contactName ?? null,
  phone: v.phone ?? null,
  email: v.email ?? null,
  destination: v.destination ?? null,
  payment_terms: v.paymentTerms ?? null,
  notes: v.notes ?? null,
  is_active: v.isActive,
});

export async function createSupplierAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = supplierSchema.safeParse({ isActive: "on", ...formObject(formData) });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  let id = "";
  const result = await runAction(async () => {
    await requirePermission("suppliers.manage");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("suppliers")
      .insert(supplierColumns(parsed.data))
      .select("id")
      .single();
    dbError(error, "create supplier");
    id = data!.id as string;
    revalidatePath("/suppliers");
  });
  if (result.message) return result;
  redirect(`/suppliers/${id}`);
}

export async function updateSupplierAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Supplier not found." };
  const parsed = supplierSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  return runAction(async () => {
    await requirePermission("suppliers.manage");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("suppliers")
      .update(supplierColumns(parsed.data))
      .eq("id", id)
      .select("id");
    dbError(error, "update supplier");
    if (!data?.length) throw new AppError("Supplier not found.", "NOT_FOUND", 404);
    revalidatePath(`/suppliers/${id}`);
    revalidatePath("/suppliers");
    return { ok: true, message: "Supplier saved." };
  });
}

export async function deleteSupplierAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Supplier not found." };
  const result = await runAction(async () => {
    await requirePermission("suppliers.manage");
    const supabase = await createClient();
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    dbError(error, "delete supplier");
    await audit(supabase, "DELETE", "supplier", id);
    revalidatePath("/suppliers");
  });
  if (result.message) return result;
  redirect("/suppliers");
}

export async function addSupplierContactAction(
  supplierId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(supplierId).success) return { message: "Supplier not found." };
  const parsed = supplierContactSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  return runAction(async () => {
    await requirePermission("suppliers.manage");
    const supabase = await createClient();
    const { error } = await supabase
      .from("supplier_contacts")
      .insert({
        supplier_id: supplierId,
        name: v.name,
        role: v.role ?? null,
        phone: v.phone ?? null,
        email: v.email ?? null,
      });
    dbError(error, "add contact");
    revalidatePath(`/suppliers/${supplierId}`);
    return { ok: true, message: "Contact added." };
  });
}

export async function deleteSupplierContactAction(
  id: string,
  supplierId: string,
): Promise<FormState> {
  if (!uuid.safeParse(id).success || !uuid.safeParse(supplierId).success)
    return { message: "Contact not found." };
  return runAction(async () => {
    await requirePermission("suppliers.manage");
    const supabase = await createClient();
    const { error } = await supabase
      .from("supplier_contacts")
      .delete()
      .eq("id", id)
      .eq("supplier_id", supplierId);
    dbError(error, "delete contact");
    revalidatePath(`/suppliers/${supplierId}`);
    return { ok: true };
  });
}

export async function addSupplierServiceAction(
  supplierId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(supplierId).success) return { message: "Supplier not found." };
  const parsed = supplierServiceSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  return runAction(async () => {
    await requirePermission("suppliers.manage");
    const supabase = await createClient();
    const { error } = await supabase.from("supplier_services").insert({
      supplier_id: supplierId,
      name: v.name,
      description: v.description ?? null,
      unit_rate: v.unitRate ?? null,
      currency: v.currency,
      valid_from: v.validFrom ?? null,
      valid_to: v.validTo ?? null,
    });
    dbError(error, "add service");
    revalidatePath(`/suppliers/${supplierId}`);
    return { ok: true, message: "Service added." };
  });
}

export async function deleteSupplierServiceAction(
  id: string,
  supplierId: string,
): Promise<FormState> {
  if (!uuid.safeParse(id).success || !uuid.safeParse(supplierId).success)
    return { message: "Service not found." };
  return runAction(async () => {
    await requirePermission("suppliers.manage");
    const supabase = await createClient();
    const { error } = await supabase
      .from("supplier_services")
      .delete()
      .eq("id", id)
      .eq("supplier_id", supplierId);
    dbError(error, "delete service");
    revalidatePath(`/suppliers/${supplierId}`);
    return { ok: true };
  });
}
