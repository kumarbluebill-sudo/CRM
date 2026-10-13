"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { formObject, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { enquirySchema, uuid, type EnquiryInput } from "@/lib/crm/schemas";

function toColumns(v: EnquiryInput) {
  return {
    requirements: v.requirements ?? null,
    destination: v.destination ?? null,
    departure_date: v.departureDate ?? null,
    return_date: v.returnDate ?? null,
    travellers: v.travellers ?? null,
    lead_source_id: v.leadSourceId ?? null,
    assigned_user_id: v.assignedUserId ?? null,
    status: v.status,
    lost_reason: v.status === "LOST" ? (v.lostReason ?? null) : null,
  };
}

// organization_id, enquiry_number and created_by are never sent: the database fills them.

export async function createEnquiryAction(
  leadId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(leadId).success) return { message: "Lead not found." };
  const parsed = enquirySchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  return runAction(async () => {
    await requirePermission("leads.update");
    const supabase = await createClient();
    const { data: lead } = await supabase.from("leads").select("id").eq("id", leadId).maybeSingle();
    if (!lead) return { message: "Lead not found." };
    const { data, error } = await supabase
      .from("enquiries")
      .insert({ lead_id: leadId, ...toColumns(parsed.data) })
      .select("enquiry_number")
      .single();
    throwIfDbError(error, "create enquiry");
    await supabase.from("lead_activities").insert({
      lead_id: leadId,
      type: "OTHER",
      summary: `Enquiry ${data!.enquiry_number} added`,
    });
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: `Enquiry ${data!.enquiry_number} added.` };
  });
}

export async function updateEnquiryAction(
  leadId: string,
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(leadId).success || !uuid.safeParse(id).success) {
    return { message: "Enquiry not found." };
  }
  const parsed = enquirySchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  return runAction(async () => {
    await requirePermission("leads.update");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("enquiries")
      .update(toColumns(parsed.data))
      .eq("id", id)
      .eq("lead_id", leadId)
      .select("id");
    throwIfDbError(error, "update enquiry");
    if (!data?.length) return { message: "Enquiry not found." };
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: "Enquiry saved." };
  });
}

/** Links a quotation or itinerary of this lead to one of its enquiries ("quotation:<id>" / "itinerary:<id>"). */
export async function linkToEnquiryAction(
  leadId: string,
  enquiryId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const item = String(formData.get("item") ?? "");
  const [kind, docId] = item.split(":");
  if (
    !uuid.safeParse(leadId).success ||
    !uuid.safeParse(enquiryId).success ||
    !uuid.safeParse(docId).success ||
    (kind !== "quotation" && kind !== "itinerary")
  ) {
    return { message: "Choose a quotation or itinerary to link." };
  }
  return runAction(async () => {
    const supabase = await createClient();
    if (kind === "quotation") {
      await requirePermission("quotes.update");
      const { error } = await supabase.rpc("link_quotation_enquiry", {
        p_quotation: docId,
        p_enquiry: enquiryId,
      });
      throwIfDbError(error, "link quotation");
    } else {
      await requirePermission("itineraries.update");
      const { data: enquiry } = await supabase
        .from("enquiries")
        .select("id")
        .eq("id", enquiryId)
        .eq("lead_id", leadId)
        .maybeSingle();
      if (!enquiry) return { message: "Enquiry not found." };
      const { data, error } = await supabase
        .from("itineraries")
        .update({ enquiry_id: enquiryId })
        .eq("id", docId)
        .eq("lead_id", leadId)
        .select("id");
      throwIfDbError(error, "link itinerary");
      if (!data?.length) return { message: "Itinerary not found." };
    }
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: "Linked." };
  });
}
