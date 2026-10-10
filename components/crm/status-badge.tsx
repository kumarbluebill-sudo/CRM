import { label } from "@/lib/crm/constants";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "primary" | "info" | "violet" | "warn" | "ok" | "bad";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-tone-neutral-soft text-tone-neutral",
  primary: "bg-tone-primary-soft text-tone-primary",
  info: "bg-tone-info-soft text-tone-info",
  violet: "bg-tone-violet-soft text-tone-violet",
  warn: "bg-tone-warn-soft text-tone-warn",
  ok: "bg-tone-ok-soft text-tone-ok",
  bad: "bg-tone-bad-soft text-tone-bad",
};

const GROUPS: Record<Tone, string[]> = {
  neutral: [
    "LOST",
    "DRAFT",
    "LOW",
    "ON_HOLD",
    "TODO",
    "CLOSED",
    "NOT_REQUIRED",
    "VOID",
    "CANCELLED",
  ],
  primary: ["NEW", "IN_PROGRESS", "SUBMITTED", "PROCESSING", "UPLOADED", "ISSUED"],
  info: [
    "CONTACTED",
    "MEDIUM",
    "ASSIGNED",
    "DOCUMENTS_RECEIVED",
    "REQUESTED",
    "NORMAL",
    "UPCOMING",
    "ACCEPTED",
    "READY_FOR_SUBMISSION",
  ],
  violet: [
    "REQUIREMENT_COLLECTED",
    "QUOTE_PREPARED",
    "QUOTE_SENT",
    "QUOTATION_SENT",
    "TEMPLATE",
    "DOCUMENT_REVIEW",
    "EMBASSY_REVIEW",
    "UNDER_REVIEW",
  ],
  warn: [
    "FOLLOW_UP",
    "NEGOTIATION",
    "HIGH",
    "WAITING_INFO",
    "DOCUMENTS_PENDING",
    "CORRECTION_REQUIRED",
    "PENDING",
    "PARTIAL",
  ],
  ok: [
    "CONFIRMED",
    "PUBLISHED",
    "COMPLETED",
    "APPROVED",
    "VISA_RECEIVED",
    "DELIVERED",
    "CONVERTED",
    "CAPTURED",
    "PAID",
  ],
  bad: ["URGENT", "REJECTED", "EXPIRED", "OVERDUE", "FAILED"],
};

export const STATUS_TONE: Record<string, Tone> = Object.fromEntries(
  (Object.entries(GROUPS) as [Tone, string[]][]).flatMap(([tone, values]) =>
    values.map((v) => [v, tone]),
  ),
);

export function StatusBadge({ value }: { value: string }) {
  const tone = STATUS_TONE[value] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex h-[22px] w-fit items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
      )}
    >
      {label(value)}
    </span>
  );
}
