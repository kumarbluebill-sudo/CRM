"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { acceptJobAction, setJobStatusAction } from "@/app/(app)/jobs/actions";
import { label } from "@/lib/crm/constants";

const selectClass =
  "border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3";

export function AcceptJobButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await acceptJobAction(id);
          if (r.message) (r.ok ? toast.success : toast.error)(r.message);
          router.refresh();
        })
      }
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      Accept this job
    </Button>
  );
}

/** Moves a job to another status. Completing needs notes; cancelling needs a reason. */
export function JobStatusForm({ id, options }: { id: string; options: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(options[0] ?? "");
  const [note, setNote] = useState("");
  const needsNote = status === "COMPLETED" || status === "CANCELLED";
  if (options.length === 0) return null;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setJobStatusAction(id, status, note);
          if (r.message) (r.ok ? toast.success : toast.error)(r.message);
          if (r.ok) setNote("");
          router.refresh();
        });
      }}
    >
      <label htmlFor={`js-${id}`} className="text-sm font-medium">
        Change status
      </label>
      <select
        id={`js-${id}`}
        className={selectClass}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {label(o)}
          </option>
        ))}
      </select>
      {(needsNote || status === "WAITING_INFO" || status === "ON_HOLD") && (
        <>
          <label htmlFor={`jn-${id}`} className="text-sm font-medium">
            {status === "COMPLETED"
              ? "Completion notes (required)"
              : status === "CANCELLED"
                ? "Reason (required)"
                : "Note (optional)"}
          </label>
          <Textarea
            id={`jn-${id}`}
            rows={3}
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            required={needsNote}
          />
        </>
      )}
      <div>
        <Button
          type="submit"
          size="sm"
          variant={status === "CANCELLED" ? "destructive" : "default"}
          disabled={pending}
        >
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Update status
        </Button>
      </div>
    </form>
  );
}
