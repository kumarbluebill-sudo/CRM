import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgLimits } from "@/lib/billing/limits";
import { AppError } from "@/lib/utils/errors";
import { AiFailedError, AiNotConfiguredError, chat, type ChatResult } from "@/lib/ai/openai";
import { bookingContext, leadContext } from "@/lib/ai/context";
import { cleanAiText } from "@/lib/ai/output";

export type AiFeature = "SUMMARIZE" | "DRAFT_MESSAGE" | "ASK" | "ITINERARY_GENERATE";

/** Throws a friendly AppError when the caller or their organization has used today's allowance. */
export async function assertAiQuota(supabase: SupabaseClient): Promise<void> {
  const [{ data: org }, { data: user }, { data: plan }] = await Promise.all([
    supabase.rpc("ai_requests_last_day"),
    supabase.rpc("ai_requests_last_day_user"),
    supabase.rpc("org_limits"),
  ]);
  // Caps come from the organization's plan (the Free plan's once a trial or subscription has ended).
  const limits = (plan as OrgLimits | null)?.limits;
  if (typeof org === "number" && org >= (limits?.aiOrgDaily ?? 10))
    throw new AppError(
      "Your organization has reached today's AI limit. Try again tomorrow, or upgrade your plan.",
      "AI_LIMIT",
      429,
    );
  if (typeof user === "number" && user >= (limits?.aiUserDaily ?? 5))
    throw new AppError("You've reached your daily AI limit. Try again tomorrow.", "AI_LIMIT", 429);
}

export async function logAiRequest(
  supabase: SupabaseClient,
  feature: AiFeature,
  status: "SUCCESS" | "FAILED" | "SKIPPED",
  r?: Pick<ChatResult, "model" | "promptTokens" | "completionTokens"> | null,
) {
  await supabase.from("ai_requests").insert({
    feature,
    status,
    model: r?.model ?? null,
    prompt_tokens: r?.promptTokens ?? null,
    completion_tokens: r?.completionTokens ?? null,
  });
}

/** Runs one completion with quota, logging and friendly errors. Prompts and output are never stored. */
export async function runCompletion(
  supabase: SupabaseClient,
  feature: AiFeature,
  system: string,
  user: string,
): Promise<string> {
  await assertAiQuota(supabase);
  try {
    const r = await chat({ system, user });
    await logAiRequest(supabase, feature, "SUCCESS", r);
    const text = cleanAiText(r.text);
    if (!text) throw new AiFailedError("empty");
    return text;
  } catch (error) {
    if (error instanceof AiNotConfiguredError)
      throw new AppError(
        "AI isn't set up yet. Ask an admin to add the OpenAI key.",
        "AI_NOT_CONFIGURED",
        503,
      );
    await logAiRequest(supabase, feature, "FAILED");
    throw new AppError("The AI request failed. Please try again.", "AI_FAILED", 502);
  }
}

/** RLS-scoped: returns null for missing or other-organization ids. */
export async function loadBookingContext(
  supabase: SupabaseClient,
  id: string,
  canSeeMoney: boolean,
  canSeeTasks: boolean,
): Promise<string | null> {
  const { data: booking } = await supabase
    .from("bookings")
    .select("*, customers ( name )")
    .eq("id", id)
    .maybeSingle();
  if (!booking) return null;
  const [items, schedule, tasks] = await Promise.all([
    supabase
      .from("booking_items")
      .select("type, description, service_date, confirmation_status")
      .eq("booking_id", id)
      .order("position")
      .limit(40),
    canSeeMoney
      ? supabase
          .from("payment_schedule_status")
          .select("label, due_date, amount, schedule_status")
          .eq("booking_id", id)
          .order("due_date")
          .limit(12)
      : Promise.resolve({ data: [] }),
    canSeeTasks
      ? supabase
          .from("tasks")
          .select("title, due_date")
          .eq("related_type", "BOOKING")
          .eq("related_id", id)
          .in("status", ["TODO", "IN_PROGRESS"])
          .limit(10)
      : Promise.resolve({ data: [] }),
  ]);
  return bookingContext({
    booking,
    items: items.data ?? [],
    schedule: schedule.data ?? [],
    tasks: tasks.data ?? [],
    canSeeMoney,
  });
}

export async function loadLeadContext(
  supabase: SupabaseClient,
  id: string,
): Promise<string | null> {
  const { data: lead } = await supabase
    .from("leads")
    .select("*, customers ( name )")
    .eq("id", id)
    .maybeSingle();
  if (!lead) return null;
  const [activities, notes] = await Promise.all([
    supabase
      .from("lead_activities")
      .select("type, summary, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("lead_notes")
      .select("body")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  return leadContext({ lead, activities: activities.data ?? [], notes: notes.data ?? [] });
}
