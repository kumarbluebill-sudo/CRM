import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Confidence } from "@/lib/import/types";

const TONE: Record<Confidence, string> = {
  high: "bg-tone-ok-soft text-tone-ok",
  medium: "bg-tone-warn-soft text-tone-warn",
  low: "bg-tone-bad-soft text-tone-bad",
};

export function ConfidenceBadge({ value }: { value: Confidence }) {
  return (
    <Badge variant="secondary" className={cn("font-medium capitalize", TONE[value])}>
      {value}
    </Badge>
  );
}
