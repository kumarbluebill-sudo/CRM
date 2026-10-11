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
import { Input } from "@/components/ui/input";
import {
  closeRestorePlanAction,
  prepareRestorePlanAction,
  runBackupNowAction,
  verifyBackupAction,
} from "@/app/(app)/settings/backups/actions";

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok?: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.message) (r.ok ? toast.success : toast.error)(r.message);
      if (r.ok) after?.();
    });
  return { pending, run };
}

export function RunBackupButton({ disabled }: { disabled?: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" disabled={disabled || pending} onClick={() => run(runBackupNowAction)}>
      {pending ? "Backing up…" : "Back up now"}
    </Button>
  );
}

export function VerifyBackupButton({ id, disabled }: { id: string; disabled?: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled || pending}
      onClick={() => run(() => verifyBackupAction(id))}
    >
      {pending ? "Checking…" : "Verify"}
    </Button>
  );
}

export function RestorePlanButton({ id, disabled }: { id: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { pending, run } = useRun();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setText("");
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" disabled={disabled} />}>
        Restore plan
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Prepare a restore plan</DialogTitle>
          <DialogDescription>
            This does not change any data. It first takes and verifies a safety backup of
            today&apos;s data, then produces a plan. The restore itself is carried out by your
            administrator following the runbook.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-sm">
          Type <strong>RESTORE</strong> to continue
          <Input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </label>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || text.trim() !== "RESTORE"}
            onClick={() =>
              run(
                () => prepareRestorePlanAction(id, text),
                () => setOpen(false),
              )
            }
          >
            {pending ? "Preparing…" : "Prepare plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClosePlanButtons({ id }: { id: string }) {
  const { pending, run } = useRun();
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run(() => closeRestorePlanAction(id, true))}
      >
        Cancel plan
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run(() => closeRestorePlanAction(id, false))}
      >
        Mark as done
      </Button>
    </div>
  );
}
