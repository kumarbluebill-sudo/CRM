"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { formObject, redirect, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { LEAD_STATUSES, label } from "@/lib/crm/constants";
import { leadSchema, noteSchema, uuid, type LeadInput } from "@/lib/crm/schemas";

function toColumns(v: LeadInput) {
  return {
    title: v.title,
    customer_id: v.customerId ?? null,
    destination: v.destination ?? null,
    departure_date: v.departureDate ?? null,
    return_date: v.returnDate ?? null,
    adults: v.adults,
    children: v.children,
    infants: v.infants,
    budget: v.budget ?? null,
    currency: v.currency,
    trip_type: v.tripType,
    hotel_category: v.hotelCategory ?? null,
    transport_required: v.transportRequired,
    visa_required: v.visaRequired,
    insurance_required: v.insuranceRequired,
    lead_source_id: v.leadSourceId ?? null,
    assigned_user_id: v.assignedUserId ?? null,
    priority: v.priority,
    status: v.status,
    notes: v.notes ?? null,
  };
}

// organization_id and created_by are never sent: the database fills them from the session.

export async function createLeadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = leadSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  let newId = "";
  const result = await runAction(async () => {
    await requirePermission("leads.create");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leads")
      .insert(toColumns(parsed.data))
      .select("id")
      .single();
    throwIfDbError(error, "create lead");
    newId = data!.id as string;
    await supabase
      .from("lead_activities")
      .insert({ lead_id: newId, type: "CREATED", summary: "Lead created" });
    revalidatePath("/leads");
  });
  if (result.message) return result;
  redirect(`/leads/${newId}`);
}

export async function updateLeadAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Lead not found." };
  const parsed = leadSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  return runAction(async () => {
    await requirePermission("leads.update");
    const supabase = await createClient();
    const { data: before } = await supabase
      .from("leads")
      .select("status, assigned_user_id")
      .eq("id", id)
      .maybeSingle();
    const { data, error } = await supabase
      .from("leads")
      .update(toColumns(parsed.data))
      .eq("id", id)
      .select("id");
    throwIfDbError(error, "update lead");
    if (!data?.length) return { message: "Lead not found." };

    const events: { type: string; summary: string }[] = [];
    if (before && before.status !== parsed.data.status) {
      events.push({
        type: "STATUS_CHANGE",
        summary: `Status: ${label(before.status)} → ${label(parsed.data.status)}`,
      });
    }
    if (before && (before.assigned_user_id ?? null) !== (parsed.data.assignedUserId ?? null)) {
      events.push({ type: "ASSIGNED", summary: "Assignee changed" });
    }
    if (events.length) {
      await supabase.from("lead_activities").insert(events.map((e) => ({ lead_id: id, ...e })));
    }
    revalidatePath("/leads");
    revalidatePath(`/leads/${id}`);
    return { ok: true, message: "Lead saved." };
  });
}

export async function moveLeadStatusAction(id: string, status: string): Promise<FormState> {
  const next = LEAD_STATUSES.find((s) => s === status);
  if (!uuid.safeParse(id).success || !next) return { message: "Invalid request." };
  return runAction(async () => {
    await requirePermission("leads.update");
    const supabase = await createClient();
    const { data: before } = await supabase
      .from("leads")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (!before) return { message: "Lead not found." };
    if (before.status === next) return { ok: true };
    const { error } = await supabase.from("leads").update({ status: next }).eq("id", id);
    throwIfDbError(error, "move lead");
    await supabase.from("lead_activities").insert({
      lead_id: id,
      type: "STATUS_CHANGE",
      summary: `Status: ${label(before.status)} → ${label(next)}`,
    });
    revalidatePath("/leads");
    revalidatePath(`/leads/${id}`);
    return { ok: true };
  });
}

export async function addLeadNoteAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Lead not found." };
  const parsed = noteSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  return runAction(async () => {
    await requirePermission("leads.update");
    const supabase = await createClient();
    const { error } = await supabase
      .from("lead_notes")
      .insert({ lead_id: id, body: parsed.data.body });
    throwIfDbError(error, "add note");
    revalidatePath(`/leads/${id}`);
    return { ok: true, message: "Note added." };
  });
}

export async function deleteLeadAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Lead not found." };
  const result = await runAction(async () => {
    await requirePermission("leads.delete");
    const supabase = await createClient();
    const { error } = await supabase.from("leads").delete().eq("id", id);
    throwIfDbError(error, "delete lead");
    revalidatePath("/leads");
  });
  if (result.message) return result;
  redirect("/leads");
}
