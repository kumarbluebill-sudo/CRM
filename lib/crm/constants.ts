export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "REQUIREMENT_COLLECTED",
  "QUOTE_PREPARED",
  "QUOTE_SENT",
  "FOLLOW_UP",
  "NEGOTIATION",
  "CONFIRMED",
  "LOST",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const TRIP_TYPES = [
  "FAMILY",
  "HONEYMOON",
  "CORPORATE",
  "GROUP",
  "SOLO",
  "ADVENTURE",
  "LUXURY",
  "BUDGET",
  "LEISURE",
  "OTHER",
] as const;

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const HOTEL_CATEGORIES = [
  "ANY",
  "BUDGET",
  "THREE_STAR",
  "FOUR_STAR",
  "FIVE_STAR",
  "LUXURY",
] as const;
export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const TASK_KINDS = ["TASK", "FOLLOWUP"] as const;

export const PAGE_SIZE = 20;

/** "REQUIREMENT_COLLECTED" -> "Requirement collected" */
export function label(value: string): string {
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const options = (values: readonly string[]) =>
  values.map((v) => ({ value: v, label: label(v) }));
