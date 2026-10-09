export const JOB_STATUSES = [
  "NEW",
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "WAITING_INFO",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export const OPEN_STATUSES: readonly string[] = [
  "NEW",
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "WAITING_INFO",
  "ON_HOLD",
];

export const RELATED_TYPES = [
  { value: "BOOKING", label: "Booking" },
  { value: "LEAD", label: "Enquiry" },
  { value: "ITINERARY", label: "Tour package / itinerary" },
  { value: "VISA_APPLICATION", label: "Visa application" },
  { value: "INVOICE", label: "Invoice" },
  { value: "QUOTATION", label: "Quotation" },
] as const;

/** Suggested designations. Any text is accepted, so agencies can use their own titles. */
export const DESIGNATIONS = [
  "Administrator",
  "Branch Manager",
  "Travel Consultant",
  "Sales Executive",
  "Visa Processing Officer",
  "Tour Operations Executive",
  "Ticketing Executive",
  "Accounts Executive",
  "Customer Support Executive",
  "Marketing Executive",
] as const;

/** Statuses a person may move a job to from its current one (mirrors set_job_status in the database). */
export const NEXT_STATUSES: Record<string, readonly JobStatus[]> = {
  ASSIGNED: ["IN_PROGRESS", "WAITING_INFO", "ON_HOLD"],
  ACCEPTED: ["IN_PROGRESS", "WAITING_INFO", "ON_HOLD", "COMPLETED"],
  IN_PROGRESS: ["WAITING_INFO", "ON_HOLD", "COMPLETED"],
  WAITING_INFO: ["IN_PROGRESS", "ON_HOLD", "COMPLETED"],
  ON_HOLD: ["IN_PROGRESS", "WAITING_INFO"],
};

export const isOverdue = (
  deadline: string | null,
  status: string,
  today = new Date().toISOString().slice(0, 10),
) => Boolean(deadline) && deadline! < today && OPEN_STATUSES.includes(status);
