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
import { removePaymentSettingsAction } from "@/app/(app)/settings/payments/actions";

export function RemovePaymentSettingsButton() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Disconnect</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect Razorpay?</DialogTitle>
          <DialogDescription>
            Online payment buttons disappear, including on customer links. Payments already received
            are kept. Payments still in progress won&apos;t be confirmed automatically.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Keep connected
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await removePaymentSettingsAction();
                if (r.message) (r.ok ? toast.success : toast.error)(r.message);
                if (r.ok) setOpen(false);
              })
            }
          >
            {pending ? "Disconnecting…" : "Disconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
