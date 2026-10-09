"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/crm/confirm-action-button";
import { setPackageStatusAction } from "@/app/(app)/itineraries/[id]/package/actions";

export function PackageStatusButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (to: string) =>
    start(async () => {
      const r = await setPackageStatusAction(id, to);
      if (r.message) (r.ok ? toast.success : toast.error)(r.message);
      router.refresh();
    });
  return (
    <>
      {status !== "PUBLISHED" && (
        <Button size="sm" disabled={pending} onClick={() => set("PUBLISHED")}>
          Publish
        </Button>
      )}
      {status === "PUBLISHED" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => set("DRAFT")}>
          Back to draft
        </Button>
      )}
      {status === "ARCHIVED" ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => set("DRAFT")}>
          Restore
        </Button>
      ) : (
        <ConfirmActionButton
          action={() => setPackageStatusAction(id, "ARCHIVED")}
          triggerLabel="Archive"
          title="Archive this package?"
          description="It stays on record and can be restored, but it is hidden from the active list."
        />
      )}
    </>
  );
}
