"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { setBookingStatusAction } from "@/app/(app)/bookings/actions";

const NEXT: Record<string, { to: string; label: string; text: string; primary?: boolean }[]> = {
  DRAFT: [
    {
      to: "PAYMENT_PENDING",
      label: "Request payment",
      text: "Moves the booking to payment pending.",
      primary: true,
    },
  ],
  PAYMENT_PENDING: [
    {
      to: "CONFIRMED",
      label: "Confirm booking",
      text: "Marks the booking as confirmed. Payments will do this automatically once they are connected.",
      primary: true,
    },
  ],
  CONFIRMED: [{ to: "IN_PROGRESS", label: "Start trip", text: "Marks the trip as in progress." }],
  IN_PROGRESS: [
    {
      to: "COMPLETED",
      label: "Complete trip",
      text: "Marks the trip as completed.",
      primary: true,
    },
  ],
};

export function BookingStatusActions({ id, status }: { id: string; status: string }) {
  const steps = NEXT[status] ?? [];
  const canCancel = ["DRAFT", "PAYMENT_PENDING", "CONFIRMED", "IN_PROGRESS"].includes(status);
  return (
    <>
      {steps.map((s) => (
        <StepButton key={s.to} id={id} step={s} />
      ))}
      {canCancel && <CancelButton id={id} />}
    </>
  );
}

function StepButton({
  id,
  step,
}: {
  id: string;
  step: { to: string; label: string; text: string; primary?: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant={step.primary ? "default" : "outline"} />}>
        {step.label}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{step.label}?</DialogTitle>
          <DialogDescription>{step.text}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await setBookingStatusAction(id, step.to);
                if (r.ok) toast.success(r.message ?? "Updated");
                else toast.error(r.message ?? "Could not update.");
                setOpen(false);
              })
            }
          >
            {pending ? "Working…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="text-destructive" />}>
        Cancel booking
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this booking?</DialogTitle>
          <DialogDescription>
            This can&apos;t be undone. A reason is recorded in the booking history.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Reason (required)
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
          />
        </label>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Keep booking
          </Button>
          <Button
            variant="destructive"
            disabled={pending || reason.trim().length === 0}
            onClick={() =>
              start(async () => {
                const r = await setBookingStatusAction(id, "CANCELLED", reason);
                if (r.ok) toast.success("Booking cancelled");
                else toast.error(r.message ?? "Could not cancel.");
                setOpen(false);
              })
            }
          >
            {pending ? "Working…" : "Cancel booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
