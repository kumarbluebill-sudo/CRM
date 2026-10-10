"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/lib/hooks/use-form-action";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/validate";
import { createVisaQuotationAction, sendVisaMessageAction } from "@/app/(app)/visa/actions";
import type { FormState } from "@/lib/auth/schemas";

const selectClass =
  "border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3";

export function CreateQuotationButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await createVisaQuotationAction(applicationId);
          if (r.message) (r.ok ? toast.success : toast.error)(r.message);
          if (r.ok) router.refresh();
        })
      }
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      Create quotation
    </Button>
  );
}

/** Uploads the final visa for one traveller. The server finds the application from the traveller. */
export function FinalVisaUpload({ travellers }: { travellers: { id: string; name: string }[] }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const picked = file.current?.files?.[0];
    if (!picked) return void toast.error("Choose the visa file.");
    if (picked.size > MAX_DOCUMENT_BYTES) return void toast.error("The file is larger than 4 MB.");
    const body = new FormData();
    body.set("file", picked);
    body.set("category", "VISA");
    for (const k of ["visaTravellerId", "visaNumber", "validFrom", "validUntil"]) {
      body.set(k, String(form.get(k) ?? ""));
    }
    setBusy(true);
    try {
      const res = await fetch("/api/documents?visa=1", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return void toast.error(json.error ?? "Upload failed.");
      toast.success("Final visa saved");
      if (file.current) file.current.value = "";
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fv-traveller" className="text-sm font-medium">
          Traveller
        </label>
        <select id="fv-traveller" name="visaTravellerId" required className={selectClass}>
          {travellers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fv-number" className="text-sm font-medium">
          Visa number
        </label>
        <Input id="fv-number" name="visaNumber" maxLength={40} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fv-from" className="text-sm font-medium">
          Valid from
        </label>
        <Input id="fv-from" name="validFrom" type="date" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fv-until" className="text-sm font-medium">
          Valid until
        </label>
        <Input id="fv-until" name="validUntil" type="date" />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label htmlFor="fv-file" className="text-sm font-medium">
          Visa file (PDF or image, up to 4 MB)
        </label>
        <input
          ref={file}
          id="fv-file"
          type="file"
          required
          accept=".pdf,.png,.jpg,.jpeg"
          className="text-sm"
        />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save final visa
        </Button>
      </div>
    </form>
  );
}

type SendState = FormState & { waUrl?: string };

const TEMPLATES: [string, string][] = [
  ["VISA_DOCUMENT_REQUEST", "Documents needed"],
  ["VISA_CORRECTION", "Document needs correcting"],
  ["VISA_STATUS_UPDATE", "Status update"],
  ["VISA_APPROVED", "Visa approved"],
  ["VISA_READY", "Visa ready"],
  ["GENERAL", "General message"],
];

export function VisaMessageForm({ applicationId }: { applicationId: string }) {
  const { state, pending, formProps } = useFormAction<SendState>(
    sendVisaMessageAction.bind(null, applicationId),
    {},
  );
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="vm-channel" className="text-sm font-medium">
            Channel
          </label>
          <select id="vm-channel" name="channel" defaultValue="EMAIL" className={selectClass}>
            <option value="EMAIL">Email</option>
            <option value="WHATSAPP">WhatsApp (opens your WhatsApp)</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="vm-template" className="text-sm font-medium">
            Message
          </label>
          <select
            id="vm-template"
            name="template"
            defaultValue="VISA_DOCUMENT_REQUEST"
            className={selectClass}
          >
            {TEMPLATES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="vm-note" className="text-sm font-medium">
          Personal note (optional)
        </label>
        <Textarea id="vm-note" name="message" rows={3} maxLength={500} />
      </div>
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={
            state.ok ? "text-sm text-tone-ok" : "text-destructive text-sm"
          }
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
