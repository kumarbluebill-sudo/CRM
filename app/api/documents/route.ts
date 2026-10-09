import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getPublicEnv } from "@/lib/env";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { getStorage, StorageUnavailableError } from "@/lib/storage";
import {
  DOCUMENT_CATEGORIES,
  MAX_DOCUMENT_BYTES,
  SENSITIVE_CATEGORIES,
  validateDocumentFile,
} from "@/lib/documents/validate";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });
const optionalId = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.string().uuid().optional(),
);
const meta = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
  bookingId: optionalId,
  customerId: optionalId,
  supplierId: optionalId,
  visaItemId: optionalId,
  // the final visa for one traveller (the application is looked up server-side from the traveller)
  visaTravellerId: optionalId,
  visaNumber: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 /-]{3,40}$/)
      .optional(),
  ),
  validFrom: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.iso.date().optional()),
  validUntil: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.iso.date().optional(),
  ),
  notes: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.string().trim().max(1000).optional(),
  ),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (
    origin &&
    new URL(origin).host !== new URL(getPublicEnv().NEXT_PUBLIC_APP_URL).host &&
    origin !== request.nextUrl.origin
  ) {
    return fail(403, "Forbidden.");
  }
  const session = await getSessionContext();
  if (!session) return fail(401, "Please sign in.");
  const isVisaUpload = Boolean(new URL(request.url).searchParams.get("visa"));
  if (
    !session.organization ||
    !(
      session.permissions.has("documents.upload") ||
      (isVisaUpload && session.permissions.has("visa.document.upload"))
    )
  )
    return fail(403, "You don't have permission to upload documents.");

  const limit = await rateLimit(`doc-upload:${session.userId}`, 20, 60_000);
  if (!limit.allowed) return fail(429, "Too many uploads. Please wait a moment.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_DOCUMENT_BYTES + 64 * 1024)
    return fail(413, "The file is larger than 4 MB.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Invalid upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "Choose a file to upload.");
  const parsed = meta.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return fail(400, "Check the document details and try again.");
  const m = parsed.data;

  // A visa checklist upload: the application and the filing category come from the checklist line in the database,
  // never from the browser, and the caller needs visa.document.upload.
  let visaApplicationId: string | null = null;
  let category = m.category;
  if (m.visaItemId) {
    if (!session.permissions.has("visa.document.upload"))
      return fail(403, "You don't have permission to upload visa documents.");
    const supabaseForItem = await createClient();
    const { data: item } = await supabaseForItem
      .from("visa_application_documents")
      .select("application_id, visa_document_types ( storage_category )")
      .eq("id", m.visaItemId)
      .maybeSingle();
    if (!item) return fail(404, "That checklist item wasn't found.");
    visaApplicationId = item.application_id as string;
    const t = item.visa_document_types as unknown as { storage_category?: string } | null;
    category = t?.storage_category === "PASSPORT" ? "PASSPORT" : "VISA";
  } else if (m.visaTravellerId) {
    if (
      !session.permissions.has("visa.process") ||
      !session.permissions.has("visa.document.upload")
    )
      return fail(403, "You don't have permission to record the final visa.");
    const supabaseForTraveller = await createClient();
    const { data: trav } = await supabaseForTraveller
      .from("visa_travellers")
      .select("application_id")
      .eq("id", m.visaTravellerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!trav) return fail(404, "That traveller wasn't found.");
    visaApplicationId = trav.application_id as string;
    category = "VISA";
  } else if (isVisaUpload) {
    return fail(400, "Choose the checklist item this file is for.");
  }

  // Sensitive categories need the permission up front (RLS enforces it again on insert).
  if (
    !visaApplicationId &&
    SENSITIVE_CATEGORIES.includes(category) &&
    !session.permissions.has("passengers.view_sensitive")
  ) {
    return fail(403, "You don't have permission to upload this kind of document.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateDocumentFile(file, bytes.subarray(0, 2048));
  if (!check.ok) return fail(415, check.error);

  let storage;
  try {
    storage = getStorage();
  } catch (error) {
    if (error instanceof StorageUnavailableError)
      return fail(503, "Document storage isn't set up yet. Please contact your administrator.");
    throw error;
  }

  // Random object name inside the organization's folder: the client filename never reaches storage.
  const path = `${session.organization.id}/${randomUUID()}.${check.ext}`;
  try {
    await storage.put(path, bytes, check.mime);
  } catch (error) {
    logger.error("document upload to storage failed", { error });
    return fail(502, "Could not store the file. Please try again.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .insert({
      category,
      name: check.displayName,
      visa_application_id: visaApplicationId,
      storage_path: path,
      mime_type: check.mime,
      size_bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      booking_id: m.bookingId ?? null,
      customer_id: m.customerId ?? null,
      supplier_id: m.supplierId ?? null,
      notes: m.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    await storage.remove(path).catch(() => undefined); // never leave an orphaned object behind
    logger.warn("document insert rejected", { code: error?.code });
    return fail(
      error?.code === "42501" ? 403 : 400,
      error?.code === "42501"
        ? "You don't have permission to upload this document."
        : "The document could not be saved.",
    );
  }
  if (m.visaItemId) {
    const { error: attachError } = await supabase.rpc("attach_visa_document", {
      p_item: m.visaItemId,
      p_document: data.id,
    });
    if (attachError) {
      logger.warn("visa document attach failed", { code: attachError.code });
      await storage.remove(path).catch(() => undefined);
      return fail(400, "The file couldn't be added to the checklist.");
    }
  }
  if (m.visaTravellerId && visaApplicationId) {
    const { error: resultError } = await supabase.rpc("record_visa_result", {
      p_app: visaApplicationId,
      p_traveller: m.visaTravellerId,
      p_document: data.id,
      p_visa_number: m.visaNumber ?? null,
      p_valid_from: m.validFrom ?? null,
      p_valid_until: m.validUntil ?? null,
      p_notes: null,
    });
    if (resultError) {
      logger.warn("visa result record failed", { code: resultError.code });
      await storage.remove(path).catch(() => undefined);
      return fail(
        resultError.code === "P0005" ? 409 : 400,
        resultError.code === "P0005"
          ? "The visa must be approved before the final file can be added."
          : "The final visa couldn't be recorded.",
      );
    }
  }
  await audit(supabase, "UPLOAD", "document", data.id as string, {
    category,
    bytes: bytes.length,
    ...(visaApplicationId ? { visaApplication: visaApplicationId } : {}),
  });
  return NextResponse.json({ id: data.id });
}
