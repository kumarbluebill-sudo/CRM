"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { formObject, redirect, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import {
  BOOKING_STATUSES,
  MAX_PASSENGERS,
  bookingItemSchema,
  bookingUpdateSchema,
  newBookingItemSchema,
  passengerSchema,
  passportSchema,
} from "@/lib/booking/schema";

type DbError = { code?: string; message: string } | null;

function throwBookingError(error: DbError, context: string) {
  switch (error?.code) {
    case "P0002":
      throw new AppError("Booking or quotation not found.", "NOT_FOUND", 404);
    case "P0005":
      throw new AppError(
        "That status change isn't allowed from the current status.",
        "INVALID_TRANSITION",
        409,
      );
    case "P0006":
      throw new AppError("The quotation needs a selected option first.", "INCOMPLETE", 409);
    case "P0007":
      throw new AppError(
        "Only approved quotations can be converted to a booking.",
        "INVALID_STATE",
        409,
      );
    case "P0008":
      throw new AppError("This quotation has already been converted.", "CONFLICT", 409);
    case "P0009":
      throw new AppError("Please give a reason for the cancellation.", "REASON_REQUIRED", 400);
    case "23505":
      throw new AppError("That already exists.", "DUPLICATE", 409);
  }
  throwIfDbError(error, context);
}

const bookingPath = (id: string) => `/bookings/${id}`;

export async function convertQuotationAction(quotationId: string): Promise<FormState> {
  if (!uuid.safeParse(quotationId).success) return { message: "Quotation not found." };
  let bookingId = "";
  const result = await runAction(async () => {
    await requirePermission("bookings.create");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("convert_quotation_to_booking", {
      p_quotation: quotationId,
    });
    throwBookingError(error, "convert quotation");
    bookingId = data as string;
    revalidatePath("/bookings");
    revalidatePath(`/quotations/${quotationId}`);
  });
  if (result.message) return result;
  redirect(bookingPath(bookingId));
}

export async function setBookingStatusAction(
  id: string,
  status: string,
  reason?: string,
): Promise<FormState> {
  const next = BOOKING_STATUSES.find((s) => s === status);
  if (!uuid.safeParse(id).success || !next) return { message: "Invalid request." };
  return runAction(async () => {
    await requirePermission("bookings.update");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_booking_status", {
      p_id: id,
      p_status: next,
      p_reason: reason?.slice(0, 500) ?? null,
    });
    throwBookingError(error, "set booking status");
    revalidatePath(bookingPath(id));
    revalidatePath("/bookings");
    return { ok: true, message: "Status updated." };
  });
}

export async function updateBookingAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Booking not found." };
  const parsed = bookingUpdateSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  return runAction(async () => {
    await requirePermission("bookings.update");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("bookings")
      .update({
        title: v.title,
        destination: v.destination ?? null,
        travel_start: v.travelStart ?? null,
        travel_end: v.travelEnd ?? null,
        adults: v.adults,
        children: v.children,
        notes: v.notes ?? null,
      })
      .eq("id", id)
      .select("id");
    throwBookingError(error, "update booking");
    if (!data?.length) throw new AppError("Booking not found.", "NOT_FOUND", 404);
    revalidatePath(bookingPath(id));
    return { ok: true, message: "Booking saved." };
  });
}

/* ---------------- passengers ---------------- */

const passengerColumns = (v: ReturnType<typeof passengerSchema.parse>) => ({
  full_name: v.fullName,
  date_of_birth: v.dateOfBirth ?? null,
  gender: v.gender ?? null,
  nationality: v.nationality ?? null,
  special_requirements: v.specialRequirements ?? null,
});

export async function addPassengerAction(
  bookingId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(bookingId).success) return { message: "Booking not found." };
  const parsed = passengerSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  return runAction(async () => {
    await requirePermission("bookings.update");
    const supabase = await createClient();
    const { count } = await supabase
      .from("booking_passengers")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", bookingId);
    if ((count ?? 0) >= MAX_PASSENGERS)
      throw new AppError(`A booking can have at most ${MAX_PASSENGERS} passengers.`, "LIMIT");
    const { error } = await supabase
      .from("booking_passengers")
      .insert({ booking_id: bookingId, ...passengerColumns(parsed.data) });
    throwBookingError(error, "add passenger");
    revalidatePath(bookingPath(bookingId));
    return { ok: true, message: "Passenger added." };
  });
}

export async function updatePassengerAction(
  id: string,
  bookingId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success || !uuid.safeParse(bookingId).success)
    return { message: "Passenger not found." };
  const parsed = passengerSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  return runAction(async () => {
    await requirePermission("bookings.update");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("booking_passengers")
      .update(passengerColumns(parsed.data))
      .eq("id", id)
      .eq("booking_id", bookingId)
      .select("id");
    throwBookingError(error, "update passenger");
    if (!data?.length) throw new AppError("Passenger not found.", "NOT_FOUND", 404);
    revalidatePath(bookingPath(bookingId));
    return { ok: true, message: "Passenger saved." };
  });
}

export async function deletePassengerAction(id: string, bookingId: string): Promise<FormState> {
  if (!uuid.safeParse(id).success || !uuid.safeParse(bookingId).success)
    return { message: "Passenger not found." };
  return runAction(async () => {
    await requirePermission("bookings.update");
    const supabase = await createClient();
    const { data: p } = await supabase
      .from("booking_passengers")
      .select("is_lead")
      .eq("id", id)
      .maybeSingle();
    if (p?.is_lead) throw new AppError("The lead passenger can't be removed.", "LOCKED", 409);
    const { error } = await supabase
      .from("booking_passengers")
      .delete()
      .eq("id", id)
      .eq("booking_id", bookingId);
    throwBookingError(error, "delete passenger");
    await audit(supabase, "DELETE", "passenger", id);
    revalidatePath(bookingPath(bookingId));
    return { ok: true, message: "Passenger removed." };
  });
}

/* ---------------- passports (strictly gated + audited) ---------------- */

export async function savePassportAction(
  passengerId: string,
  bookingId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(passengerId).success || !uuid.safeParse(bookingId).success)
    return { message: "Passenger not found." };
  const parsed = passportSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  return runAction(async () => {
    await requirePermission("passengers.view_sensitive");
    const supabase = await createClient();
    const { error } = await supabase
      .from("passenger_identity")
      .upsert(
        {
          passenger_id: passengerId,
          passport_number: v.passportNumber,
          passport_expiry: v.passportExpiry ?? null,
          passport_country: v.passportCountry ?? null,
        },
        { onConflict: "passenger_id" },
      );
    throwBookingError(error, "save passport");
    await audit(supabase, "UPDATE", "passenger_identity", passengerId); // never the number itself
    revalidatePath(bookingPath(bookingId));
    return { ok: true, message: "Passport details saved." };
  });
}

export async function revealPassportAction(
  passengerId: string,
): Promise<{ ok: boolean; number?: string; message?: string }> {
  if (!uuid.safeParse(passengerId).success) return { ok: false, message: "Passenger not found." };
  try {
    await requirePermission("passengers.view_sensitive");
    const supabase = await createClient();
    const { data } = await supabase
      .from("passenger_identity")
      .select("passport_number")
      .eq("passenger_id", passengerId)
      .maybeSingle();
    if (!data) return { ok: false, message: "No passport on file." };
    await audit(supabase, "VIEW", "passenger_identity", passengerId);
    return { ok: true, number: data.passport_number as string };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof AppError ? error.message : "Could not load the passport.",
    };
  }
}

export async function deletePassportAction(
  passengerId: string,
  bookingId: string,
): Promise<FormState> {
  if (!uuid.safeParse(passengerId).success || !uuid.safeParse(bookingId).success)
    return { message: "Passenger not found." };
  return runAction(async () => {
    await requirePermission("passengers.view_sensitive");
    const supabase = await createClient();
    const { error } = await supabase
      .from("passenger_identity")
      .delete()
      .eq("passenger_id", passengerId);
    throwBookingError(error, "delete passport");
    await audit(supabase, "DELETE", "passenger_identity", passengerId);
    revalidatePath(bookingPath(bookingId));
    return { ok: true, message: "Passport details removed." };
  });
}

/* ---------------- service lines ---------------- */

export async function updateBookingItemAction(
  id: string,
  bookingId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success || !uuid.safeParse(bookingId).success)
    return { message: "Service not found." };
  const parsed = bookingItemSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  return runAction(async () => {
    await requirePermission("bookings.update");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("booking_items")
      .update({
        description: v.description,
        supplier_id: v.supplierId ?? null,
        service_date: v.serviceDate ?? null,
        confirmation_status: v.confirmationStatus,
        confirmation_reference: v.confirmationReference ?? null,
        notes: v.notes ?? null,
      })
      .eq("id", id)
      .eq("booking_id", bookingId)
      .select("id");
    throwBookingError(error, "update booking item");
    if (!data?.length) throw new AppError("Service not found.", "NOT_FOUND", 404);
    revalidatePath(bookingPath(bookingId));
    return { ok: true, message: "Service saved." };
  });
}

export async function addBookingItemAction(
  bookingId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(bookingId).success) return { message: "Booking not found." };
  const parsed = newBookingItemSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  return runAction(async () => {
    await requirePermission("bookings.update");
    const supabase = await createClient();
    const { count } = await supabase
      .from("booking_items")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", bookingId);
    const { error } = await supabase.from("booking_items").insert({
      booking_id: bookingId,
      position: (count ?? 0) + 1,
      type: v.type,
      description: v.description,
      quantity: v.quantity,
      supplier_id: v.supplierId ?? null,
      service_date: v.serviceDate ?? null,
    });
    throwBookingError(error, "add booking item");
    revalidatePath(bookingPath(bookingId));
    return { ok: true, message: "Service added." };
  });
}
