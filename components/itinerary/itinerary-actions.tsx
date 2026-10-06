"use client";

import { useTransition } from "react";
import { Copy, LayoutTemplate } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/crm/confirm-action-button";
import { deleteItineraryAction, duplicateItineraryAction } from "@/app/(app)/itineraries/actions";

export function ItineraryActions({
  id,
  canCreate,
  canDelete,
}: {
  id: string;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [pending, start] = useTransition();
  const run = (asTemplate: boolean) =>
    start(async () => {
      const res = await duplicateItineraryAction(id, asTemplate); // redirects on success
      if (res?.message) toast.error(res.message);
    });

  return (
    <>
      {canCreate && (
        <>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(false)}>
            <Copy className="size-4" aria-hidden /> Duplicate
          </Button>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(true)}>
            <LayoutTemplate className="size-4" aria-hidden /> Save as template
          </Button>
        </>
      )}
      {canDelete && (
        <ConfirmActionButton
          action={deleteItineraryAction.bind(null, id)}
          triggerLabel="Delete"
          title="Delete this itinerary?"
          description="This permanently removes the itinerary, all its days and its version history."
        />
      )}
    </>
  );
}
