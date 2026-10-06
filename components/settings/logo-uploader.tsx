"use client";

import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removeLogoAction, uploadLogoAction } from "@/app/(app)/settings/actions";
import type { FormState } from "@/lib/auth/schemas";

export function LogoUploader({ logo }: { logo: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadLogoAction, {});
  const [removing, startRemove] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Logo</h2>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt="Current agency logo"
          className="bg-muted max-h-20 w-fit rounded border p-2"
        />
      ) : (
        <p className="text-muted-foreground text-sm">No logo uploaded yet.</p>
      )}
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input
          name="logo"
          type="file"
          accept="image/png,image/jpeg"
          className="text-sm"
          aria-label="Logo file"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
        {logo && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={removing}
            onClick={() =>
              startRemove(async () => {
                const r = await removeLogoAction();
                if (r.ok) toast.success(r.message ?? "Removed");
                else toast.error(r.message ?? "Could not remove.");
              })
            }
          >
            Remove
          </Button>
        )}
      </form>
      <p className="text-muted-foreground text-xs">PNG or JPEG, up to 300 KB.</p>
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "text-sm text-green-700" : "text-destructive text-sm"}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
