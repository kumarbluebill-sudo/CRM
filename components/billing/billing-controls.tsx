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
import {
  cancelSubscriptionAction,
  startCheckoutAction,
} from "@/app/(app)/settings/billing/actions";

export function ChoosePlanButton({ planKey, label }: { planKey: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await startCheckoutAction(planKey);
          if (r.url) {
            window.location.assign(r.url); // hosted Razorpay page; validated as https on the server
            return;
          }
          if (r.message) toast.error(r.message);
        })
      }
    >
      {pending ? "Opening checkout…" : label}
    </Button>
  );
}

export function CancelPlanButton() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Cancel plan</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel your plan?</DialogTitle>
          <DialogDescription>
            You keep everything you&apos;ve paid for until the end of the current billing period.
            After that the organization moves to the Free plan. Your data is never deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Keep my plan
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await cancelSubscriptionAction();
                if (r.message) (r.ok ? toast.success : toast.error)(r.message);
                if (r.ok) setOpen(false);
              })
            }
          >
            {pending ? "Cancelling…" : "Cancel at period end"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
