import { Badge } from "@/components/ui/badge";
import { label } from "@/lib/crm/constants";
import { cn } from "@/lib/utils";

const TONES: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  CONTACTED: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  REQUIREMENT_COLLECTED: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  QUOTE_PREPARED: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  QUOTE_SENT: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  FOLLOW_UP: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  NEGOTIATION: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  CONFIRMED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  LOST: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PUBLISHED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  TEMPLATE: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  LOW: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  MEDIUM: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  URGENT: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  TODO: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  IN_PROGRESS: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  DOCUMENTS_PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  DOCUMENTS_RECEIVED: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  DOCUMENT_REVIEW: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  CORRECTION_REQUIRED: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  READY_FOR_SUBMISSION: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  SUBMITTED: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  PROCESSING: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  EMBASSY_REVIEW: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  APPROVED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  VISA_RECEIVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  DELIVERED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  CLOSED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  CONVERTED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  QUOTATION_SENT: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  REQUESTED: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  UPLOADED: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  UNDER_REVIEW: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  NORMAL: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  NOT_REQUIRED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  EXPIRED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  CAPTURED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  PAID: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  ISSUED: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  PARTIAL: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  UPCOMING: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  OVERDUE: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  VOID: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  CANCELLED: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function StatusBadge({ value }: { value: string }) {
  return (
    <Badge variant="secondary" className={cn("font-medium", TONES[value])}>
      {label(value)}
    </Badge>
  );
}
