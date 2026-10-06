import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getPublicEnv } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { ExtractionError, extractText } from "@/lib/import/extract";
import { isAiConfigured, structureWithAi } from "@/lib/import/ai";
import { parseItineraryText } from "@/lib/import/parse";
import { MAX_IMPORT_BYTES, validateImportFile } from "@/lib/import/validate";

export const runtime = "nodejs";
export const maxDuration = 60;

const AI_DAILY_LIMIT = 10; // fallback only; the real cap is the organization's plan (org_limits)

const fail = (status: number, error: string, headers?: Record<string, string>) =>
  NextResponse.json({ error }, { status, headers });

export async function POST(request: NextRequest) {
  // 1. CSRF: browsers always send Origin on cross-site POSTs.
  const origin = request.headers.get("origin");
  if (
    origin &&
    new URL(origin).host !== new URL(getPublicEnv().NEXT_PUBLIC_APP_URL).host &&
    origin !== request.nextUrl.origin
  ) {
    return fail(403, "Forbidden.");
  }

  // 2. Authenticate, identify organization, check permission (all server-side).
  const session = await getSessionContext();
  if (!session) return fail(401, "Please sign in.");
  if (!session.organization || !session.permissions.has("itineraries.create")) {
    return fail(403, "You don't have permission to import itineraries.");
  }

  // 3. Rate limit.
  const limit = (await rateLimit(`import:${session.userId}`, 10, 60_000));
  if (!limit.allowed) {
    return fail(429, "Too many uploads. Please wait a moment.", {
      "retry-after": String(limit.retryAfterSeconds),
    });
  }

  // 4. Cheap size check before reading the body.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_IMPORT_BYTES + 64 * 1024) return fail(413, "The file is larger than 4 MB.");

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return fail(400, "Invalid upload.");
  }
  if (!file) return fail(400, "Choose a file to upload.");

  // 5. Validate size, extension, MIME type and real file signature.
  const buffer = Buffer.from(await file.arrayBuffer());
  const check = validateImportFile(file, new Uint8Array(buffer.subarray(0, 2048)));
  if (!check.ok) return fail(415, check.error);

  // 6. Extract text in memory (the original file is never stored).
  let text: string;
  try {
    text = await extractText(check.type, buffer);
  } catch (error) {
    return fail(
      422,
      error instanceof ExtractionError ? error.message : "The document could not be read.",
    );
  }
  if (text.length < 20) {
    return fail(
      422,
      "No readable text was found. Scanned documents and images are not supported yet.",
    );
  }

  // 7. Parse: rule-based baseline, optionally upgraded by AI (validated; falls back on any failure).
  const supabase = await createClient();
  let parsed = parseItineraryText(text);
  if (isAiConfigured()) {
    const { data: used } = await supabase.rpc("ai_requests_last_day");
    const { data: plan } = await supabase.rpc("org_limits");
    const cap =
      (plan as { limits?: { aiOrgDaily?: number } } | null)?.limits?.aiOrgDaily ?? AI_DAILY_LIMIT;
    if (typeof used === "number" && used >= cap) {
      parsed.warnings.push("The daily AI limit was reached, so the rule-based parser was used.");
      await supabase.from("ai_requests").insert({ feature: "ITINERARY_IMPORT", status: "SKIPPED" });
    } else {
      const ai = await structureWithAi(text);
      await supabase.from("ai_requests").insert({
        feature: "ITINERARY_IMPORT",
        model: ai?.model ?? null,
        status: ai ? "SUCCESS" : "FAILED",
        prompt_tokens: ai?.promptTokens ?? null,
        completion_tokens: ai?.completionTokens ?? null,
      });
      if (ai) {
        if (ai.parsed.days.length !== parsed.days.length) {
          ai.parsed.warnings.push(
            `AI found ${ai.parsed.days.length} day(s); the rule-based parser found ${parsed.days.length}. Please compare with the source text.`,
          );
        }
        ai.parsed.warnings.push(...parsed.warnings.filter((w) => w.includes("instruction-like")));
        parsed = ai.parsed;
      } else {
        parsed.warnings.push("AI structuring was unavailable, so the rule-based parser was used.");
      }
    }
  }

  // 8. Save as a review draft. organization_id/created_by come from the session in the database.
  const { data, error } = await supabase
    .from("itinerary_imports")
    .insert({
      file_name: check.safeName,
      file_type: check.type,
      file_size: buffer.length,
      file_sha256: createHash("sha256").update(buffer).digest("hex"),
      parsed,
      source_text: text,
    })
    .select("id")
    .single();
  if (error || !data) {
    logger.error("import insert failed", { code: error?.code, error: error?.message });
    return fail(500, "Something went wrong. Please try again.");
  }
  return NextResponse.json({ id: data.id });
}
