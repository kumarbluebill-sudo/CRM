export const APPLICATION_STATUSES = [
  "DRAFT",
  "NEW",
  "DOCUMENTS_PENDING",
  "DOCUMENTS_RECEIVED",
  "DOCUMENT_REVIEW",
  "CORRECTION_REQUIRED",
  "READY_FOR_SUBMISSION",
  "SUBMITTED",
  "PROCESSING",
  "EMBASSY_REVIEW",
  "APPROVED",
  "VISA_RECEIVED",
  "DELIVERED",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const ENQUIRY_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUOTATION_SENT",
  "FOLLOW_UP",
  "CONVERTED",
  "LOST",
  "CANCELLED",
] as const;

export const DOCUMENT_STATUSES = [
  "NOT_REQUIRED",
  "PENDING",
  "REQUESTED",
  "UPLOADED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "CORRECTION_REQUIRED",
  "EXPIRED",
] as const;

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const VISA_TYPES = [
  "TOURIST",
  "BUSINESS",
  "TRANSIT",
  "STUDENT",
  "MEDICAL",
  "WORK",
  "OTHER",
] as const;
export const ENTRY_TYPES = ["SINGLE", "DOUBLE", "MULTIPLE"] as const;
export const APPLICANT_TYPES = ["ADULT", "CHILD", "INFANT"] as const;

/**
 * Allowed next statuses. This MUST mirror set_visa_status() in database/migrations/024_visa_core.sql (the database is
 * the authority; a unit test fails if the two drift). The UI uses it only to decide which buttons to show.
 */
export const VISA_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  DRAFT: ["NEW", "CANCELLED"],
  NEW: ["DOCUMENTS_PENDING", "CANCELLED"],
  DOCUMENTS_PENDING: ["DOCUMENTS_RECEIVED", "CANCELLED"],
  DOCUMENTS_RECEIVED: ["DOCUMENT_REVIEW", "DOCUMENTS_PENDING", "CANCELLED"],
  DOCUMENT_REVIEW: ["READY_FOR_SUBMISSION", "CORRECTION_REQUIRED", "CANCELLED"],
  CORRECTION_REQUIRED: ["DOCUMENTS_RECEIVED", "DOCUMENT_REVIEW", "CANCELLED"],
  READY_FOR_SUBMISSION: ["SUBMITTED", "DOCUMENT_REVIEW", "CANCELLED"],
  SUBMITTED: ["PROCESSING", "REJECTED", "CANCELLED"],
  PROCESSING: ["EMBASSY_REVIEW", "APPROVED", "REJECTED", "CANCELLED"],
  EMBASSY_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["VISA_RECEIVED"],
  VISA_RECEIVED: ["DELIVERED"],
  DELIVERED: ["CLOSED"],
  REJECTED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

/** Statuses that need a typed reason before the change is accepted. */
export const REASON_REQUIRED: readonly ApplicationStatus[] = [
  "REJECTED",
  "CANCELLED",
  "CORRECTION_REQUIRED",
];

/** Before a submission the application can still slip; after it the supplier/embassy is in charge. */
export const PRE_SUBMISSION: readonly ApplicationStatus[] = [
  "DRAFT",
  "NEW",
  "DOCUMENTS_PENDING",
  "DOCUMENTS_RECEIVED",
  "DOCUMENT_REVIEW",
  "CORRECTION_REQUIRED",
  "READY_FOR_SUBMISSION",
];

const DAY = 86_400_000;
const today = (now: Date) => Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

/** Days until a date (negative if past); null when there is no date. */
export function daysUntil(date: string | null, now = new Date()): number | null {
  if (!date) return null;
  return Math.floor((Date.parse(date) - today(now)) / DAY);
}

/** Travel date within a week and the application is still not submitted. */
export function isTravelUrgent(
  travelDate: string | null,
  status: string,
  now = new Date(),
): boolean {
  if (!travelDate || !(PRE_SUBMISSION as readonly string[]).includes(status)) return false;
  const days = daysUntil(travelDate, now);
  return days !== null && days >= 0 && days <= 7;
}

/** Message when the passport will not satisfy the product's validity rule on the travel date; null if fine. */
export function passportWarning(
  expiry: string | null,
  travelDate: string | null,
  minMonths: number,
  now = new Date(),
): string | null {
  if (!expiry) return null;
  const exp = Date.parse(expiry);
  if (exp < now.getTime()) return "Passport has expired.";
  const needed = new Date(travelDate ? Date.parse(travelDate) : now.getTime());
  needed.setUTCMonth(needed.getUTCMonth() + minMonths);
  if (exp < needed.getTime())
    return `Passport must be valid for ${minMonths} months after travel; it expires ${expiry}.`;
  return null;
}
