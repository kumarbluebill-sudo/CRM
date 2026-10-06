"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/crm/confirm-action-button";
import { convertImportAction, discardImportAction } from "@/app/(app)/itineraries/import/actions";

export function ImportReviewActions({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await convertImportAction(id); // redirects to the builder on success
            if (res?.message) toast.error(res.message);
          })
        }
      >
        {pending ? "Creating draft…" : "Create draft itinerary"}
      </Button>
      <ConfirmActionButton
        action={discardImportAction.bind(null, id)}
        triggerLabel="Discard"
        title="Discard this import?"
        description="The extracted content will be deleted. This cannot be undone."
      />
    </div>
  );
}
