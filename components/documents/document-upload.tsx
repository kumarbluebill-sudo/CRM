"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { label } from "@/lib/crm/constants";
import {
  DOCUMENT_CATEGORIES,
  MAX_DOCUMENT_BYTES,
  SENSITIVE_CATEGORIES,
} from "@/lib/documents/validate";

export function DocumentUpload({
  bookingId,
  customerId,
  canSensitive,
}: {
  bookingId?: string;
  customerId?: string;
  canSensitive: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = DOCUMENT_CATEGORIES.filter(
    (c) => canSensitive || !SENSITIVE_CATEGORIES.includes(c),
  );

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const file = input.current?.files?.[0];
    if (!file) return setError("Choose a file.");
    if (file.size > MAX_DOCUMENT_BYTES) return setError("The file is larger than 4 MB.");
    const body = new FormData(form);
    if (bookingId) body.set("bookingId", bookingId);
    if (customerId) body.set("customerId", customerId);
    setBusy(true);
    try {
      const res = await fetch("/api/documents", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(json.error ?? "Upload failed.");
      toast.success("Document uploaded");
      form.reset();
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Category
        <select
          name="category"
          defaultValue="OTHER"
          className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        File (PDF, DOCX, XLSX, TXT, PNG, JPG · max 4 MB)
        <input
          ref={input}
          name="file"
          type="file"
          accept=".pdf,.docx,.xlsx,.txt,.png,.jpg,.jpeg"
          className="text-sm"
          disabled={busy}
        />
      </label>
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
        Notes
        <Input name="notes" maxLength={1000} />
      </label>
      <Button type="submit" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Upload
      </Button>
      {error && (
        <p role="alert" className="text-destructive w-full text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
