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
  changePlanAction,
  previewPlanChangeAction,
  type PlanPreview,
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

/** Upgrade or downgrade a live subscription: shows what the new plan allows before anything changes. */
export function ChangePlanButton({ planKey, label }: { planKey: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setPreview(null);
          start(async () => setPreview(await previewPlanChangeAction(planKey)));
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>{label}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {preview?.direction === "downgrade"
              ? "The new plan starts at the end of your current billing period."
              : "The new plan starts as soon as the payment is confirmed."}{" "}
            Your data is never deleted.
          </DialogDescription>
        </DialogHeader>
        <div className="text-sm" aria-live="polite">
          {!preview ? (
            <p className="text-muted-foreground">Checking your usage…</p>
          ) : preview.message ? (
            <p className="text-destructive">{preview.message}</p>
          ) : preview.overLimit && preview.overLimit.length > 0 ? (
            <div>
              <p className="mb-1 font-medium">You currently use more than this plan includes:</p>
              <ul className="list-disc pl-5">
                {preview.overLimit.map((o) => (
                  <li key={o.item}>
                    {o.item}: {o.used} used, {o.limit} included
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-2">
                Everything stays readable; you just can&apos;t add more of these until you are
                within the limit.
              </p>
            </div>
          ) : (
            <p>Everything you use now fits in this plan.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Keep my plan
          </Button>
          <Button
            disabled={pending || !preview || Boolean(preview.message)}
            onClick={() =>
              start(async () => {
                const r = await changePlanAction(planKey);
                if (r.message) (r.ok ? toast.success : toast.error)(r.message);
                if (r.ok) setOpen(false);
              })
            }
          >
            {pending ? "Working…" : "Confirm change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
