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
import type { FormState } from "@/lib/auth/schemas";

/** Destructive action behind a confirmation dialog. */
export function ConfirmActionButton({
  action,
  triggerLabel,
  title,
  description,
}: {
  action: () => Promise<FormState>;
  triggerLabel: string;
  title: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await action(); // redirects on success
                if (res?.message) {
                  toast.error(res.message);
                  setOpen(false);
                }
              })
            }
          >
            {pending ? "Working…" : triggerLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
