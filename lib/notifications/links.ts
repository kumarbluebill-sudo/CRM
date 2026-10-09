export const NOTIFICATION_TYPES = [
  "LEAD_ASSIGNED",
  "BOOKING_CREATED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "INVOICE_ISSUED",
  "DEPARTURE_SOON",
  "VISA_DOC_ISSUE",
  "VISA_STATUS",
  "JOB_ASSIGNED",
  "JOB_DEADLINE",
  "JOB_OVERDUE",
  "JOB_COMPLETED",
  "SECURITY",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const TYPE_LABELS: Record<NotificationType, string> = {
  LEAD_ASSIGNED: "A new enquiry is assigned to me",
  BOOKING_CREATED: "A new booking is created",
  PAYMENT_RECEIVED: "A payment is received",
  PAYMENT_OVERDUE: "A payment becomes overdue",
  INVOICE_ISSUED: "An invoice is issued",
  DEPARTURE_SOON: "A departure is approaching",
  VISA_DOC_ISSUE: "A visa document is missing or needs correcting",
  VISA_STATUS: "A visa application changes status",
  JOB_ASSIGNED: "A job is assigned to me",
  JOB_DEADLINE: "A job deadline is approaching",
  JOB_OVERDUE: "A job is overdue",
  JOB_COMPLETED: "A job I assigned is completed",
  SECURITY: "Team and security changes",
};

/**
 * Where a notification leads. These are ordinary pages: they apply the reader's own permissions again, so a link never
 * grants access to anything. Unknown or missing targets fall back to the notification list.
 */
export function notificationHref(entityType: string | null, entityId: string | null): string {
  if (!entityType) return "/notifications";
  if (entityType === "TEAM") return "/settings/team";
  if (!entityId || !/^[0-9a-f-]{36}$/i.test(entityId)) return "/notifications";
  switch (entityType) {
    case "LEAD":
      return `/leads/${entityId}`;
    case "BOOKING":
      return `/bookings/${entityId}`;
    case "INVOICE":
      return `/payments/invoices/${entityId}`;
    case "VISA_APPLICATION":
      return `/visa/applications/${entityId}`;
    case "JOB_ORDER":
      return `/jobs/${entityId}`;
    case "CUSTOMER":
      return `/customers/${entityId}`;
    default:
      return "/notifications";
  }
}
