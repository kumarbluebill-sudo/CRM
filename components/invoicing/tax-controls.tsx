"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  removeSignatureAction,
  uploadSignatureAction,
  verifyTaxCodeAction,
} from "@/app/(app)/settings/invoicing/actions";
import type { FormState } from "@/lib/auth/schemas";

export function VerifyTaxCodeButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await verifyTaxCodeAction(id);
          if (r.message) (r.ok ? toast.success : toast.error)(r.message);
          router.refresh();
        })
      }
    >
      Mark as verified
    </Button>
  );
}

export function SignatureUploader({ signature }: { signature: string | null }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<FormState, FormData>(uploadSignatureAction, {});
  const [removing, startRemove] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Authorised signature or stamp (optional)</h3>
      {signature ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={signature}
          alt="Current signature"
          className="max-h-20 w-fit rounded border bg-white object-contain p-2"
        />
      ) : (
        <p className="text-muted-foreground text-sm">None uploaded.</p>
      )}
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input
          name="signature"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="text-sm"
          aria-label="Signature image"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
        {signature && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={removing}
            onClick={() =>
              startRemove(async () => {
                const r = await removeSignatureAction();
                if (r.message) (r.ok ? toast.success : toast.error)(r.message);
                router.refresh();
              })
            }
          >
            Remove
          </Button>
        )}
      </form>
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "text-tone-ok text-sm" : "text-destructive text-sm"}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
