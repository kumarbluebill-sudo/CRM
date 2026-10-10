"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge } from "@/components/itinerary/confidence-badge";
import { markReviewedAction } from "@/app/(app)/itineraries/import/actions";
import type { FlaggedEntry } from "@/lib/import/parse";

export function ReviewBanner({
  id,
  flagged,
  canReview,
}: {
  id: string;
  flagged: FlaggedEntry[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div
      role="region"
      aria-label="Review required"
      className="rounded-lg border border-tone-warn/30 bg-tone-warn-soft p-4 text-sm text-tone-warn"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="flex-1">
          <p className="font-medium">Imported content — review required before publishing</p>
          <p className="mt-1">
            Check the details below against the original document, make any edits, then confirm.
            Publishing is blocked until then.
          </p>
          {flagged.length > 0 && (
            <ul className="mt-3 flex max-h-48 flex-col gap-1 overflow-y-auto">
              {flagged.slice(0, 30).map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span>
                    {f.where} · {f.kind}: {f.text}
                  </span>
                  <ConfidenceBadge value={f.confidence} />
                </li>
              ))}
            </ul>
          )}
        </div>
        {canReview && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await markReviewedAction(id);
                if (res.message && !res.ok) toast.error(res.message);
                else {
                  toast.success(res.message ?? "Reviewed");
                  router.refresh();
                }
              })
            }
          >
            I&apos;ve reviewed this
          </Button>
        )}
      </div>
    </div>
  );
}
