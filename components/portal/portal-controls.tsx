"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createPortalLinkAction,
  revokePortalLinkAction,
  setDocumentSharedAction,
} from "@/app/(app)/bookings/portal-actions";

export function CreateLinkForm({ bookingId }: { bookingId: string }) {
  const [pending, start] = useTransition();
  const [days, setDays] = useState("30");
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          Valid for
          <Input
            type="number"
            min={1}
            max={180}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="w-20"
            aria-label="Days the link stays valid"
          />
          days
        </label>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await createPortalLinkAction(bookingId, Number(days));
              if (r.url) setUrl(r.url);
              if (r.message) (r.ok ? toast.success : toast.error)(r.message);
            })
          }
        >
          {pending ? "Creating…" : "Create customer link"}
        </Button>
      </div>
      {url && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
          <Input
            readOnly
            value={url}
            aria-label="Customer link"
            className="min-w-64 flex-1 font-mono text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                toast.success("Copied.");
              } catch {
                toast.error("Couldn't copy. Select the link and copy it manually.");
              }
            }}
          >
            Copy
          </Button>
          <p className="text-muted-foreground w-full text-xs">
            Anyone with this link can see this booking. It can&apos;t be shown again after you leave
            this page.
          </p>
        </div>
      )}
    </div>
  );
}

export function RevokeLinkButton({ bookingId, id }: { bookingId: string; id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await revokePortalLinkAction(bookingId, id);
          if (r.message) (r.ok ? toast.success : toast.error)(r.message);
        })
      }
    >
      Revoke
    </Button>
  );
}

export function ShareDocumentToggle({
  bookingId,
  id,
  shared,
}: {
  bookingId: string;
  id: string;
  shared: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant={shared ? "secondary" : "outline"}
      disabled={pending}
      aria-pressed={shared}
      onClick={() =>
        start(async () => {
          const r = await setDocumentSharedAction(bookingId, id, !shared);
          if (r.message && !r.ok) toast.error(r.message);
        })
      }
    >
      {shared ? "Shared" : "Share"}
    </Button>
  );
}
