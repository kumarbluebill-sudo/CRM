"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(app)/notifications/actions";

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const r = await markAllNotificationsReadAction();
          if (r.message) toast.success(r.message);
          router.refresh();
        })
      }
    >
      Mark all as read
    </Button>
  );
}

export function MarkReadButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markNotificationReadAction(id);
          router.refresh();
        })
      }
    >
      Mark read
    </Button>
  );
}
