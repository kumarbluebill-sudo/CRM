"use client";

import { useFormAction } from "@/lib/hooks/use-form-action";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/auth/schemas";
import { loadCheckout } from "@/lib/payments/checkout";
import { submitPortalRequestAction } from "@/app/portal/actions";

export function PayNow({
  token,
  balance,
  currency,
}: {
  token: string;
  balance: number;
  currency: string;
}) {
  const router = useRouter();
  const amountRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pay-amount" className="text-sm font-medium">
            Amount ({currency})
          </label>
          <Input
            id="pay-amount"
            ref={amountRef}
            type="number"
            min={1}
            max={balance}
            step="0.01"
            defaultValue={balance}
            className="w-40"
          />
        </div>
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setNote(null);
              const res = await fetch(`/api/portal/${token}/pay`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ amount: Number(amountRef.current?.value) }),
              }).catch(() => null);
              const data = res ? await res.json().catch(() => ({})) : {};
              if (!res || !res.ok) {
                setNote({
                  ok: false,
                  text: data.error ?? "Couldn't start the payment. Please try again.",
                });
                return;
              }
              try {
                const Razorpay = await loadCheckout();
                new Razorpay({
                  key: data.keyId,
                  order_id: data.orderId,
                  amount: data.amountMinor,
                  currency: data.currency,
                  name: data.name,
                  handler: () => {
                    setNote({
                      ok: true,
                      text: "Thank you! Your payment is being confirmed. This page will update shortly.",
                    });
                    setTimeout(() => router.refresh(), 4000);
                  },
                  modal: { ondismiss: () => router.refresh() },
                }).open();
              } catch {
                setNote({ ok: false, text: "Couldn't load the payment window. Please try again." });
              }
            })
          }
        >
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Pay securely
        </Button>
      </div>
      {note && (
        <p
          role={note.ok ? "status" : "alert"}
          className={note.ok ? "text-sm text-tone-ok" : "text-destructive text-sm"}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}

export function RequestForm({ token }: { token: string }) {
  const { state, pending, formProps } = useFormAction<FormState>(
    submitPortalRequestAction.bind(null, token),
    {},
  );
  return (
    <form {...formProps} className="flex flex-col gap-2" noValidate>
      <label htmlFor="portal-message" className="text-sm font-medium">
        Questions or changes
      </label>
      <Textarea id="portal-message" name="message" rows={3} maxLength={1000} required />
      {state.fieldErrors?.message && (
        <p className="text-destructive text-xs">{state.fieldErrors.message[0]}</p>
      )}
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "text-sm text-tone-ok" : "text-destructive text-sm"}
        >
          {state.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Send to our team
        </Button>
      </div>
    </form>
  );
}
