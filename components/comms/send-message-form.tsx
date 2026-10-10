"use client";

import { useFormAction } from "@/lib/hooks/use-form-action";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendBookingMessageAction, type SendState } from "@/app/(app)/communications/actions";
import { TEMPLATE_KEYS, TEMPLATE_LABELS } from "@/lib/comms/templates";

const selectClass =
  "border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3";

export function SendMessageForm({ bookingId }: { bookingId: string }) {
  const { state, pending, formProps } = useFormAction<SendState>(
    sendBookingMessageAction.bind(null, bookingId),
    {},
  );
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="msg-channel" className="text-sm font-medium">
            Channel
          </label>
          <select id="msg-channel" name="channel" defaultValue="EMAIL" className={selectClass}>
            <option value="EMAIL">Email</option>
            <option value="WHATSAPP">WhatsApp (opens your WhatsApp)</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="msg-template" className="text-sm font-medium">
            Template
          </label>
          <select id="msg-template" name="template" defaultValue="GENERAL" className={selectClass}>
            {TEMPLATE_KEYS.filter((k) => !k.startsWith("VISA_")).map((k) => (
              <option key={k} value={k}>
                {TEMPLATE_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="msg-note" className="text-sm font-medium">
          Personal note (optional)
        </label>
        <Textarea id="msg-note" name="message" rows={3} maxLength={500} />
        {state.fieldErrors?.message && (
          <p className="text-destructive text-xs">{state.fieldErrors.message[0]}</p>
        )}
      </div>
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "text-tone-ok text-sm" : "text-destructive text-sm"}
        >
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Send
        </Button>
        {state.waUrl && (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={state.waUrl} target="_blank" rel="noopener noreferrer" />}
          >
            Open WhatsApp
          </Button>
        )}
      </div>
    </form>
  );
}
