"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { convertQuotationAction } from "@/app/(app)/bookings/actions";

export function ConvertToBookingButton({ quotationId }: { quotationId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Convert to booking</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert to a booking?</DialogTitle>
          <DialogDescription>
            This creates a booking from the selected option, adds the customer as lead passenger and
            creates operations tasks. A quotation can only be converted once.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await convertQuotationAction(quotationId); // redirects on success
                if (r?.message) {
                  toast.error(r.message);
                  setOpen(false);
                }
              })
            }
          >
            {pending ? "Converting…" : "Convert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
