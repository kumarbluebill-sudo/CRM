"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  createRemindersAction,
  deleteScheduleAction,
  startOnlinePaymentAction,
  voidInvoiceAction,
} from "@/app/(app)/payments/actions";
import { loadCheckout } from "@/lib/payments/checkout";

/**
 * Starts an online payment. The server decides the order and amount; the browser result is never trusted.
 * The payment is marked paid only when Razorpay's signed webhook reaches the server, so we just refresh.
 */
export function OnlinePayButton({ bookingId, balance }: { bookingId: string; balance: number }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const amountRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Collect online</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Collect an online payment</DialogTitle>
          <DialogDescription>
            Opens Razorpay Checkout for the amount below. The payment shows as paid once Razorpay
            confirms it, usually within a few seconds.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="online-amount" className="text-sm font-medium">
            Amount
          </label>
          <Input
            id="online-amount"
            ref={amountRef}
            type="number"
            min={1}
            max={balance}
            step="0.01"
            defaultValue={balance}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const amount = Number(amountRef.current?.value);
                const r = await startOnlinePaymentAction(bookingId, amount);
                if (!r.checkout) {
                  toast.error(r.message ?? "Couldn't start the payment.");
                  return;
                }
                try {
                  const Razorpay = await loadCheckout();
                  setOpen(false);
                  new Razorpay({
                    key: r.checkout.keyId,
                    order_id: r.checkout.orderId,
                    amount: r.checkout.amountMinor,
                    currency: r.checkout.currency,
                    name: r.checkout.name,
                    handler: () => {
                      toast.success("Payment submitted. Waiting for confirmation…");
                      setTimeout(() => router.refresh(), 3000);
                    },
                    modal: { ondismiss: () => router.refresh() },
                  }).open();
                } catch {
                  toast.error("Couldn't load Razorpay Checkout.");
                }
              })
            }
          >
            {pending ? "Starting…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteScheduleButton({ bookingId, id }: { bookingId: string; id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await deleteScheduleAction(bookingId, id);
          if (r.message && !r.ok) toast.error(r.message);
        })
      }
    >
      Remove
    </Button>
  );
}

export function VoidInvoiceButton({
  bookingId,
  invoiceId,
}: {
  bookingId: string;
  invoiceId: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const reason = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="ghost" />}>Void</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void this invoice?</DialogTitle>
          <DialogDescription>
            The invoice stays on record marked void, and a new one can be issued.
          </DialogDescription>
        </DialogHeader>
        <Input ref={reason} aria-label="Reason" placeholder="Reason (required)" maxLength={500} />
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await voidInvoiceAction(
                  bookingId,
                  invoiceId,
                  reason.current?.value ?? "",
                );
                if (r.ok) setOpen(false);
                if (r.message) (r.ok ? toast.success : toast.error)(r.message);
              })
            }
          >
            Void invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemindersButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await createRemindersAction();
          if (r.message) (r.ok ? toast.success : toast.error)(r.message);
        })
      }
    >
      {pending ? "Creating…" : "Create reminder tasks"}
    </Button>
  );
}
