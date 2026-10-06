"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { formObject, runAction, throwIfDbError } from "@/lib/crm/action-utils";
import { taskSchema, taskStatusSchema, uuid } from "@/lib/crm/schemas";

export async function createTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = taskSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  if (Boolean(v.relatedType) !== Boolean(v.relatedId)) return { message: "Invalid link." };
  return runAction(async () => {
    await requirePermission("tasks.manage");
    const supabase = await createClient();
    const { error } = await supabase.from("tasks").insert({
      title: v.title,
      description: v.description ?? null,
      kind: v.kind,
      assigned_to: v.assignedTo ?? null,
      due_date: v.dueDate ?? null,
      priority: v.priority,
      related_type: v.relatedType ?? null,
      related_id: v.relatedId ?? null,
    });
    throwIfDbError(error, "create task");
    revalidatePath("/tasks");
    if (v.relatedType === "LEAD") revalidatePath(`/leads/${v.relatedId}`);
    return { ok: true, message: "Task created." };
  });
}

export async function setTaskStatusAction(id: string, status: string): Promise<FormState> {
  const next = taskStatusSchema.safeParse(status);
  if (!uuid.safeParse(id).success || !next.success) return { message: "Invalid request." };
  return runAction(async () => {
    await requirePermission("tasks.manage");
    const supabase = await createClient();
    const { error } = await supabase
      .from("tasks")
      .update({
        status: next.data,
        completed_at: next.data === "COMPLETED" ? new Date().toISOString() : null,
      })
      .eq("id", id);
    throwIfDbError(error, "update task");
    revalidatePath("/tasks");
    return { ok: true };
  });
}
