"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cancelQueuedAction, sendQueuedAction } from "@/app/(app)/communications/actions";

export function SendQueuedButton({ id, retry }: { id: string; retry?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await sendQueuedAction(id);
          if (r.waUrl) {
            const url = r.waUrl;
            toast.success(r.message, {
              duration: 15000,
              action: {
                label: "Open WhatsApp",
                onClick: () => window.open(url, "_blank", "noopener,noreferrer"),
              },
            });
          } else if (r.message) {
            (r.ok ? toast.success : toast.error)(r.message);
          }
        })
      }
    >
      {pending ? "Sending…" : retry ? "Retry" : "Review & send"}
    </Button>
  );
}

export function DiscardButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await cancelQueuedAction(id);
          if (r.message && !r.ok) toast.error(r.message);
        })
      }
    >
      Discard
    </Button>
  );
}
