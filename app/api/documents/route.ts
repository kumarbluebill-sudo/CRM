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
  if (!session.organization || !session.permissions.has("documents.upload"))
    return fail(403, "You don't have permission to upload documents.");

  const limit = (await rateLimit(`doc-upload:${session.userId}`, 20, 60_000));
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

  // Sensitive categories need the permission up front (RLS enforces it again on insert).
  if (
    SENSITIVE_CATEGORIES.includes(m.category) &&
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
      category: m.category,
      name: check.displayName,
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
  await audit(supabase, "UPLOAD", "document", data.id as string, {
    category: m.category,
    bytes: bytes.length,
  });
  return NextResponse.json({ id: data.id });
}
