import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Confidence } from "@/lib/import/types";

const TONE: Record<Confidence, string> = {
  high: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  low: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export function ConfidenceBadge({ value }: { value: Confidence }) {
  return (
    <Badge variant="secondary" className={cn("font-medium capitalize", TONE[value])}>
      {value}
    </Badge>
  );
}
