"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { formObject, redirect, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { customerSchema, uuid, type CustomerInput } from "@/lib/crm/schemas";

function toColumns(v: CustomerInput) {
  return {
    name: v.name,
    phone: v.phone ?? null,
    whatsapp: v.whatsapp ?? null,
    email: v.email ?? null,
    date_of_birth: v.dateOfBirth ?? null,
    address: v.address ?? null,
    city: v.city ?? null,
    state: v.state ?? null,
    country: v.country ?? null,
    nationality: v.nationality ?? null,
    notes: v.notes ?? null,
  };
}

export async function createCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = customerSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  let newId = "";
  const result = await runAction(async () => {
    await requirePermission("customers.create");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .insert(toColumns(parsed.data))
      .select("id")
      .single();
    throwIfDbError(error, "create customer");
    newId = data!.id as string;
    revalidatePath("/customers");
  });
  if (result.message) return result;
  redirect(`/customers/${newId}`);
}

export async function updateCustomerAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Customer not found." };
  const parsed = customerSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  return runAction(async () => {
    await requirePermission("customers.update");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .update(toColumns(parsed.data))
      .eq("id", id)
      .select("id");
    throwIfDbError(error, "update customer");
    if (!data?.length) return { message: "Customer not found." };
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
    return { ok: true, message: "Customer saved." };
  });
}
