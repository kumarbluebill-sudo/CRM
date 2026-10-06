import type { FormField } from "@/components/forms/entity-form";
import { PRIORITIES, TASK_KINDS, options } from "@/lib/crm/constants";
import type { TeamMember } from "@/lib/crm/types";

/**
 * Field set for the task form. */
export function taskFields(args: {
  team: TeamMember[];
  relatedType?: "LEAD" | "CUSTOMER";
  relatedId?: string;
  compact?: boolean;
}): FormField[] {
  const fields: FormField[] = [
    { name: "title", label: "Title", required: true, wide: true },
    {
      name: "kind",
      label: "Type",
      type: "select",
      required: true,
      options: options(TASK_KINDS),
      defaultValue: args.relatedId ? "FOLLOWUP" : "TASK",
    },
    { name: "dueDate", label: "Due date", type: "date" },
    {
      name: "priority",
      label: "Priority",
      type: "select",
      required: true,
      options: options(PRIORITIES),
      defaultValue: "MEDIUM",
    },
    {
      name: "assignedTo",
      label: "Assign to",
      type: "select",
      options: args.team.map((m) => ({ value: m.userId, label: m.name })),
    },
  ];
  if (!args.compact) fields.push({ name: "description", label: "Description", type: "textarea" });
  return fields;
}
