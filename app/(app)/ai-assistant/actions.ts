"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";
import { rateLimit } from "@/lib/rate-limit";
import { formObject, redirect, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { ASK_PROMPT, SUMMARIZE_PROMPT, draftPrompt } from "@/lib/ai/prompts";
import { itineraryBrief } from "@/lib/ai/context";
import {
  assertAiQuota,
  loadBookingContext,
  loadLeadContext,
  logAiRequest,
  runCompletion,
} from "@/lib/ai/service";
import { generateItineraryWithAi, isAiConfigured } from "@/lib/import/ai";

export type AssistantState = FormState & { text?: string };

const optional = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(max).optional(),
  );

const schema = z
  .object({
    entityType: z.enum(["BOOKING", "LEAD"]),
    entityId: uuid,
    task: z.enum(["SUMMARIZE", "DRAFT_MESSAGE", "ASK"]),
    channel: z.enum(["EMAIL", "WHATSAPP"]).default("EMAIL"),
    intent: optional(300),
    question: optional(500),
  })
  .superRefine((v, ctx) => {
    if (v.task === "DRAFT_MESSAGE" && !v.intent)
      ctx.addIssue({
        code: "custom",
        path: ["intent"],
        message: "Say what the message should do.",
      });
    if (v.task === "ASK" && !v.question)
      ctx.addIssue({ code: "custom", path: ["question"], message: "Type your question." });
  });

/**
 * Runs one assistant task. The model only ever sees a record the caller can already open (loaded through RLS), it has
 * no tools, and its answer is plain text for a person to read. Nothing is saved or sent.
 */
export async function runAssistantAction(
  _prev: AssistantState,
  formData: FormData,
): Promise<AssistantState> {
  const parsed = schema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  try {
    const session = await requirePermission("ai.use");
    const needed = v.entityType === "BOOKING" ? "bookings.view" : "leads.view";
    if (!session.permissions.has(needed))
      throw new AppError("You don't have permission to view that record.", "FORBIDDEN", 403);
    if (!(await rateLimit(`ai:${session.userId}`, 10, 60_000)).allowed)
      throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);

    const supabase = await createClient();
    const context =
      v.entityType === "BOOKING"
        ? await loadBookingContext(
            supabase,
            v.entityId,
            session.permissions.has("payments.view"),
            session.permissions.has("tasks.view"),
          )
        : await loadLeadContext(supabase, v.entityId);
    if (!context) throw new AppError("Record not found.", "NOT_FOUND", 404);

    const text = await runCompletion(
      supabase,
      v.task,
      v.task === "SUMMARIZE"
        ? SUMMARIZE_PROMPT
        : v.task === "ASK"
          ? ASK_PROMPT
          : draftPrompt(v.channel),
      v.task === "SUMMARIZE"
        ? `${context}\n\nSummarise this record.`
        : v.task === "ASK"
          ? `${context}\n\n<question>\n${v.question}\n</question>`
          : `${context}\n\n<intent>\n${v.intent}\n</intent>`,
    );
    return { ok: true, text };
  } catch (error) {
    if (error instanceof AppError) return { message: error.message };
    logger.error("assistant action failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { message: "Something went wrong. Please try again." };
  }
}

/**
 * Drafts an itinerary suggestion from a lead's requirements. It is saved as an import awaiting review, so the existing
 * review gate applies: it can't be published until a person confirms they checked it.
 */
export async function generateItineraryAction(
  leadId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(leadId).success) return { message: "Lead not found." };
  const extra = optional(600).safeParse(formData.get("instructions"));
  if (!extra.success) return { fieldErrors: { instructions: ["Keep it under 600 characters."] } };
  let importId = "";
  try {
    const session = await requirePermission("ai.use");
    for (const p of ["itineraries.create", "leads.view"] as const)
      if (!session.permissions.has(p))
        throw new AppError("You don't have permission to do that.", "FORBIDDEN", 403);
    if (!(await rateLimit(`ai-itin:${session.userId}`, 5, 60_000)).allowed)
      throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
    if (!isAiConfigured())
      throw new AppError(
        "AI isn't set up yet. Ask an admin to add the OpenAI key.",
        "AI_NOT_CONFIGURED",
        503,
      );

    const supabase = await createClient();
    const { data: lead } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle();
    if (!lead) throw new AppError("Lead not found.", "NOT_FOUND", 404);
    if (!lead.destination)
      throw new AppError("Add a destination to the lead first.", "INCOMPLETE", 409);

    await assertAiQuota(supabase);
    const brief = itineraryBrief(lead, extra.data);
    const ai = await generateItineraryWithAi(brief);
    await logAiRequest(supabase, "ITINERARY_GENERATE", ai ? "SUCCESS" : "FAILED", ai);
    if (!ai || ai.parsed.days.length === 0)
      throw new AppError("The AI couldn't draft an itinerary. Please try again.", "AI_FAILED", 502);

    const { data, error } = await supabase
      .from("itinerary_imports")
      .insert({
        file_name: `AI draft: ${String(lead.title)}`.slice(0, 120),
        file_type: "AI",
        file_size: brief.length,
        file_sha256: createHash("sha256").update(brief).digest("hex"),
        parsed: ai.parsed,
        source_text: brief,
      })
      .select("id")
      .single();
    throwIfDbError(error, "save AI itinerary");
    importId = data!.id as string;
  } catch (error) {
    if (error instanceof AppError) return { message: error.message };
    logger.error("generate itinerary failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { message: "Something went wrong. Please try again." };
  }
  redirect(`/itineraries/import/${importId}`);
}
