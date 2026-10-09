"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createDraftInvoiceAction } from "@/app/(app)/payments/invoices/actions";

/** Starts a draft invoice from the booking and opens it for editing. */
export function CreateInvoiceButton({ bookingId }: { bookingId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await createDraftInvoiceAction(bookingId);
          if (r?.message) toast.error(r.message);
        })
      }
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      Create invoice
    </Button>
  );
}
