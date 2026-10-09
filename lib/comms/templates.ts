export const TEMPLATE_KEYS = [
  "GENERAL",
  "QUOTATION_SENT",
  "BOOKING_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_REMINDER",
  "PAYMENT_OVERDUE",
  "TRIP_REMINDER",
  "VISA_DOCUMENT_REQUEST",
  "VISA_CORRECTION",
  "VISA_STATUS_UPDATE",
  "VISA_APPROVED",
  "VISA_READY",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export const CHANNELS = ["EMAIL", "WHATSAPP"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Variables a template may use. Anything else renders as empty, so a typo can never leak data. */
export const TEMPLATE_VARS = [
  "customer_name",
  "org_name",
  "booking_number",
  "trip_title",
  "destination",
  "travel_start",
  "amount_due",
  "currency",
  "due_date",
  "installment",
  "message",
  "application_number",
  "country",
  "visa_type",
  "documents_pending",
  "expected_completion",
] as const;

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  GENERAL: "General message",
  QUOTATION_SENT: "Quotation sent",
  BOOKING_CONFIRMED: "Booking confirmed",
  PAYMENT_RECEIVED: "Payment received",
  PAYMENT_REMINDER: "Payment reminder (due soon)",
  PAYMENT_OVERDUE: "Payment overdue",
  TRIP_REMINDER: "Trip reminder",
  VISA_DOCUMENT_REQUEST: "Visa: documents needed",
  VISA_CORRECTION: "Visa: document needs correcting",
  VISA_STATUS_UPDATE: "Visa: status update",
  VISA_APPROVED: "Visa: approved",
  VISA_READY: "Visa: ready for collection",
};

type Tpl = { subject: string; body: string };

const SIGN = "\n\nWarm regards,\n{{org_name}}";

export const DEFAULT_TEMPLATES: Record<TemplateKey, Tpl> = {
  GENERAL: {
    subject: "A message from {{org_name}}",
    body: "Hello {{customer_name}},\n\n{{message}}" + SIGN,
  },
  QUOTATION_SENT: {
    subject: "Your travel quotation from {{org_name}}",
    body:
      "Hello {{customer_name}},\n\nThank you for your interest. Your quotation for {{trip_title}} is ready." +
      "\n\n{{message}}\n\nPlease let us know if you would like any changes." +
      SIGN,
  },
  BOOKING_CONFIRMED: {
    subject: "Booking {{booking_number}} confirmed",
    body:
      "Hello {{customer_name}},\n\nGreat news: your booking {{booking_number}} for {{trip_title}} is confirmed." +
      "\n\n{{message}}" +
      SIGN,
  },
  PAYMENT_RECEIVED: {
    subject: "Payment received for {{booking_number}}",
    body:
      "Hello {{customer_name}},\n\nWe have received your payment for booking {{booking_number}}. Thank you!" +
      "\n\nOutstanding balance: {{currency}} {{amount_due}}.\n\n{{message}}" +
      SIGN,
  },
  PAYMENT_REMINDER: {
    subject: "Payment due soon for {{booking_number}}",
    body:
      "Hello {{customer_name}},\n\nA friendly reminder that {{installment}} of {{currency}} {{amount_due}} for booking " +
      "{{booking_number}} is due on {{due_date}}.\n\n{{message}}" +
      SIGN,
  },
  PAYMENT_OVERDUE: {
    subject: "Payment overdue for {{booking_number}}",
    body:
      "Hello {{customer_name}},\n\nOur records show {{installment}} of {{currency}} {{amount_due}} for booking " +
      "{{booking_number}} was due on {{due_date}}. Please arrange payment at your earliest convenience, or get in " +
      "touch if you have already paid.\n\n{{message}}" +
      SIGN,
  },
  TRIP_REMINDER: {
    subject: "Your trip to {{destination}} is coming up",
    body:
      "Hello {{customer_name}},\n\nYour trip {{trip_title}} starts on {{travel_start}}. Please keep your travel " +
      "documents ready.\n\n{{message}}" +
      SIGN,
  },
  VISA_DOCUMENT_REQUEST: {
    subject: "Documents needed for your {{country}} visa ({{application_number}})",
    body:
      "Hello {{customer_name}},\n\nTo continue your {{country}} {{visa_type}} visa application {{application_number}}, " +
      "we still need: {{documents_pending}}.\n\n{{message}}" +
      SIGN,
  },
  VISA_CORRECTION: {
    subject: "A document needs correcting ({{application_number}})",
    body:
      "Hello {{customer_name}},\n\nWe reviewed your documents for visa application {{application_number}} and " +
      "something needs to be corrected or re-sent: {{documents_pending}}.\n\n{{message}}" +
      SIGN,
  },
  VISA_STATUS_UPDATE: {
    subject: "Update on your {{country}} visa ({{application_number}})",
    body:
      "Hello {{customer_name}},\n\nHere is an update on your {{country}} visa application {{application_number}}. " +
      "Expected completion: {{expected_completion}}.\n\n{{message}}" +
      SIGN,
  },
  VISA_APPROVED: {
    subject: "Good news: your {{country}} visa is approved",
    body:
      "Hello {{customer_name}},\n\nYour {{country}} {{visa_type}} visa ({{application_number}}) has been approved. " +
      "We will share it with you shortly.\n\n{{message}}" +
      SIGN,
  },
  VISA_READY: {
    subject: "Your {{country}} visa is ready",
    body:
      "Hello {{customer_name}},\n\nYour {{country}} visa ({{application_number}}) is ready. {{message}}" +
      SIGN,
  },
};

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const clean = (v: unknown) => (typeof v === "string" ? v.replace(CTRL, "").slice(0, 500) : "");

/** Substitutes {{name}} placeholders from an allow-list. Unknown or missing names become empty. */
export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  const allowed = new Set<string>(TEMPLATE_VARS);
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) =>
      allowed.has(name) ? clean(vars[name]) : "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A single-line header value (no CR/LF) for email subjects. */
export const oneLine = (s: string) =>
  s
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain text to minimal, safe HTML (everything escaped, line breaks kept). */
export function textToHtml(text: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
}

/** WhatsApp click-to-chat link. `digits` must already be digits only (the database stores it that way). */
export function whatsappLink(digits: string, text: string): string | null {
  if (!/^\d{7,15}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text.slice(0, 1500))}`;
}
