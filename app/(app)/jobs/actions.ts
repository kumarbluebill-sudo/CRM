"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/utils/errors";
import { rateLimit } from "@/lib/rate-limit";
import { formObject, redirect, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { uuid } from "@/lib/crm/schemas";
import { JOB_STATUSES } from "@/lib/jobs/constants";
import { jobSchema } from "@/lib/jobs/schema";

type DbError = { code?: string; message: string } | null;

function throwJobError(error: DbError, context: string) {
  const fail = (m: string, c: string, s = 409): never => {
    throw new AppError(m, c, s);
  };
  switch (error?.code) {
    case "P0002":
      return fail("That job, person or record wasn't found.", "NOT_FOUND", 404);
    case "P0005":
      return fail("That change isn't allowed from the job's current status.", "INVALID_TRANSITION");
    case "P0009":
      return fail(
        "Please add the notes or reason that are required for this step.",
        "REASON_REQUIRED",
        400,
      );
    case "P0060":
      return fail("That staff member is inactive and can't be given work.", "INACTIVE");
    case "P0061":
      return fail(
        "Only a job manager can assign work to an owner or administrator.",
        "RESTRICTED_ASSIGNEE",
        403,
      );
    case "42501":
      return fail("You don't have permission to do that.", "FORBIDDEN", 403);
    case "22023":
      return fail("Some values are invalid. Please check the form.", "INVALID_VALUE", 400);
  }
  throwIfDbError(error, context);
}

async function guard(permission: Parameters<typeof requirePermission>[0], key: string, limit = 60) {
  const session = await requirePermission(permission);
  if (!(await rateLimit(`${key}:${session.userId}`, limit, 60_000)).allowed)
    throw new AppError("Too many requests. Please wait a moment.", "RATE_LIMITED", 429);
  return session;
}

const open = (id: string) => `/jobs/${id}`;
const refresh = (id?: string) => {
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  if (id) revalidatePath(open(id));
};

export async function createJobAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = jobSchema.safeParse(formObject(formData));
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  let id = "";
  const result = await runAction(async () => {
    await guard("jobs.create", "job-create", 30);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_job_order", { p: parsed.data });
    throwJobError(error, "create job order");
    id = data as string;
    refresh();
  });
  if (result.message) return result;
  redirect(open(id));
}

export async function acceptJobAction(id: string): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Job not found." };
  return runAction(async () => {
    await guard("jobs.view", "job-accept");
    const supabase = await createClient();
    const { error } = await supabase.rpc("accept_job_order", { p_id: id });
    throwJobError(error, "accept job order");
    refresh(id);
    return { ok: true, message: "Job accepted." };
  });
}

export async function setJobStatusAction(
  id: string,
  status: string,
  note?: string,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Job not found." };
  if (!(JOB_STATUSES as readonly string[]).includes(status)) return { message: "Invalid status." };
  if ((status === "COMPLETED" || status === "CANCELLED") && !note?.trim())
    return { message: status === "COMPLETED" ? "Add completion notes." : "Give a reason." };
  return runAction(async () => {
    await guard("jobs.view", "job-status");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_job_status", {
      p_id: id,
      p_status: status,
      p_note: note?.slice(0, 2000) ?? null,
    });
    throwJobError(error, "set job status");
    refresh(id);
    return { ok: true, message: "Status updated." };
  });
}

export async function addJobCommentAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Job not found." };
  const text = String(formData.get("comment") ?? "").trim();
  if (!text) return { fieldErrors: { comment: ["Write a comment."] } };
  if (text.length > 2000) return { fieldErrors: { comment: ["Keep it under 2000 characters."] } };
  return runAction(async () => {
    await guard("jobs.view", "job-comment");
    const supabase = await createClient();
    const { error } = await supabase.rpc("add_job_comment", { p_id: id, p_text: text });
    throwJobError(error, "add job comment");
    refresh(id);
    return { ok: true, message: "Comment added." };
  });
}

export async function reassignJobAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Job not found." };
  const to = String(formData.get("assignedTo") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!uuid.safeParse(to).success)
    return { fieldErrors: { assignedTo: ["Choose who it goes to."] } };
  if (reason.length < 3) return { fieldErrors: { reason: ["Say why it is being reassigned."] } };
  return runAction(async () => {
    await guard("jobs.assign", "job-reassign", 30);
    const supabase = await createClient();
    const { error } = await supabase.rpc("reassign_job_order", {
      p_id: id,
      p_to: to,
      p_reason: reason.slice(0, 500),
    });
    throwJobError(error, "reassign job order");
    refresh(id);
    return { ok: true, message: "Job reassigned." };
  });
}

export async function updateJobAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { message: "Job not found." };
  const parsed = jobSchema.partial({ title: true }).safeParse(formObject(formData));
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const v = parsed.data;
  return runAction(async () => {
    await guard("jobs.view", "job-update", 30);
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_job_order", {
      p_id: id,
      p: {
        title: v.title,
        instructions: v.instructions,
        priority: v.priority,
        startDate: v.startDate ?? "",
        deadline: v.deadline ?? "",
        assignedTeam: v.assignedTeam ?? "",
      },
    });
    throwJobError(error, "update job order");
    refresh(id);
    return { ok: true, message: "Job updated." };
  });
}
