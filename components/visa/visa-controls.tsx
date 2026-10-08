"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/validate";
import { label } from "@/lib/crm/constants";
import { REASON_REQUIRED, type ApplicationStatus } from "@/lib/visa/constants";
import {
  deleteApplicationAction,
  removeChecklistItemAction,
  removeTravellerAction,
  requestDocumentAction,
  reviewDocumentAction,
  setApplicationStatusAction,
  setEnquiryStatusAction,
} from "@/app/(app)/visa/actions";

type Result = { ok?: boolean; message?: string };
const report = (r: Result) => {
  if (r.message) (r.ok ? toast.success : toast.error)(r.message);
};

/** Uploads one file against one checklist line. The server derives the application and filing category itself. */
export function UploadButton({ itemId, replace }: { itemId: string; replace?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_DOCUMENT_BYTES) return void toast.error("The file is larger than 4 MB.");
    const body = new FormData();
    body.set("file", file);
    body.set("visaItemId", itemId);
    body.set("category", "VISA"); // replaced server-side from the checklist line
    setBusy(true);
    try {
      const res = await fetch("/api/documents?visa=1", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return void toast.error(json.error ?? "Upload failed.");
      toast.success("Uploaded");
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.txt"
        className="sr-only"
        aria-label={replace ? "Choose a replacement file" : "Choose a file to upload"}
        tabIndex={-1}
        onChange={onPick}
      />
      <Button size="xs" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
        {replace ? "Replace" : "Upload"}
      </Button>
    </>
  );
}

/** Approve / reject / ask for a correction, with the document previewed beside the decision. */
export function ReviewPanel({
  applicationId,
  itemId,
  documentId,
  mime,
  name,
  canApprove,
  canReject,
}: {
  applicationId: string;
  itemId: string;
  documentId: string;
  mime: string;
  name: string;
  canApprove: boolean;
  canReject: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const src = `/api/documents/${documentId}/download?inline=1`;
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";

  const decide = (decision: string) =>
    start(async () => {
      const r = await reviewDocumentAction(applicationId, itemId, decision, note);
      report(r);
      if (r.ok) {
        setOpen(false);
        setNote("");
      }
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="outline" />}>Review</DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            Check the document, then approve it or tell the customer what to fix.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
          <div className="bg-muted flex min-h-80 items-center justify-center overflow-hidden rounded-lg border">
            {open && isImage && (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable
              <img src={src} alt={`Preview of ${name}`} className="max-h-[28rem] object-contain" />
            )}
            {open && isPdf && (
              <iframe src={src} title={`Preview of ${name}`} className="h-[28rem] w-full" />
            )}
            {open && !isImage && !isPdf && (
              <p className="text-muted-foreground p-6 text-center text-sm">
                This file type can&apos;t be previewed here.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <a
              href={src.replace("?inline=1", "")}
              className="text-primary text-sm underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Download original
            </a>
            <label htmlFor={`note-${itemId}`} className="text-sm font-medium">
              Note (required to reject or request a correction)
            </label>
            <Textarea
              id={`note-${itemId}`}
              rows={4}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Passport scan is unclear"
            />
          </div>
        </div>
        <DialogFooter>
          {canReject && (
            <>
              <Button
                variant="destructive"
                disabled={pending || note.trim().length < 3}
                onClick={() => decide("REJECTED")}
              >
                Reject
              </Button>
              <Button
                variant="outline"
                disabled={pending || note.trim().length < 3}
                onClick={() => decide("CORRECTION_REQUIRED")}
              >
                Request correction
              </Button>
            </>
          )}
          {canApprove && (
            <Button disabled={pending} onClick={() => decide("APPROVED")}>
              {pending ? "Saving…" : "Approve"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RequestDocumentButton({
  applicationId,
  itemId,
}: {
  applicationId: string;
  itemId: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() => start(async () => report(await requestDocumentAction(applicationId, itemId)))}
    >
      Mark requested
    </Button>
  );
}

export function RemoveChecklistButton({
  applicationId,
  itemId,
}: {
  applicationId: string;
  itemId: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => report(await removeChecklistItemAction(applicationId, itemId)))
      }
    >
      Remove
    </Button>
  );
}

export function RemoveTravellerButton({
  applicationId,
  travellerId,
  name,
}: {
  applicationId: string;
  travellerId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="ghost" />}>Remove</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {name}?</DialogTitle>
          <DialogDescription>
            Their checklist is closed. Files already uploaded are kept for the record.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await removeTravellerAction(applicationId, travellerId);
                report(r);
                if (r.ok) setOpen(false);
              })
            }
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Buttons for the statuses allowed from here. Reason-required ones ask for the reason first. */
export function StatusButtons({
  applicationId,
  next,
  canProcess,
  kind = "application",
}: {
  applicationId: string;
  next: readonly string[];
  canProcess: boolean;
  kind?: "application" | "enquiry";
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  if (!canProcess || next.length === 0) return null;

  const needsReason = (s: string) =>
    kind === "enquiry"
      ? s === "LOST" || s === "CANCELLED"
      : REASON_REQUIRED.includes(s as ApplicationStatus);
  const run = (status: string, why?: string) =>
    start(async () => {
      const r =
        kind === "enquiry"
          ? await setEnquiryStatusAction(applicationId, status, why)
          : await setApplicationStatusAction(applicationId, status, why);
      report(r);
      if (r.ok) {
        setTarget(null);
        setReason("");
      }
    });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {next.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === "CANCELLED" || s === "REJECTED" || s === "LOST" ? "outline" : "default"}
            disabled={pending}
            onClick={() => (needsReason(s) ? setTarget(s) : run(s))}
          >
            {label(s)}
          </Button>
        ))}
      </div>
      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to {target ? label(target) : ""}?</DialogTitle>
            <DialogDescription>A reason is recorded in the timeline.</DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < 3}
              onClick={() => target && run(target, reason)}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Soft delete (the record is kept for retention). Only offered for new or cancelled applications. */
export function DeleteApplicationButton({ applicationId }: { applicationId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="self-start" />}>
        Delete application
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this application?</DialogTitle>
          <DialogDescription>
            It disappears from lists but is kept on record. This can only be done for new or
            cancelled applications.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteApplicationAction(applicationId); // redirects on success
                if (r?.message) report(r);
              })
            }
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
