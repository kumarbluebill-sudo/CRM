"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  confirmEnrolAction,
  removeFactorAction,
  setRequireAdminMfaAction,
  signOutEverywhereAction,
  signOutOthersAction,
  startEnrolAction,
} from "@/app/(app)/profile/security/actions";

export function MfaSetup() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {!step ? (
        <div>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await startEnrolAction();
                if (r.ok && r.factorId && r.qr && r.secret)
                  setStep({ factorId: r.factorId, qr: r.qr, secret: r.secret });
                else setError(r.message ?? "Could not start setup.");
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Set up two-step verification
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const r = await confirmEnrolAction(step.factorId, code);
              if (!r.ok) return void setError(r.message ?? "That code didn't work.");
              toast.success(r.message ?? "Two-step verification is on.");
              setStep(null);
              setCode("");
              router.refresh();
            });
          }}
        >
          <ol className="list-decimal pl-5 text-sm">
            <li>
              Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy,
              1Password…).
            </li>
            <li>Scan this code, or type the key below into the app.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={step.qr}
            alt="QR code to scan with your authenticator app"
            className="size-44 rounded border bg-white p-2"
          />
          <p className="text-sm">
            Can&apos;t scan? Enter this key:{" "}
            <code
              data-testid="mfa-secret"
              className="bg-muted rounded px-1.5 py-0.5 text-xs break-all"
            >
              {step.secret}
            </code>
          </p>
          <div className="flex max-w-xs flex-col gap-1.5">
            <label htmlFor="mfa-code" className="text-sm font-medium">
              6-digit code
            </label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Turn on
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setStep(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

export function RemoveFactorButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="destructive"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            "Remove two-step verification from your account? You'll sign in with just your password.",
          )
        )
          return;
        start(async () => {
          const r = await removeFactorAction(id);
          if (r?.message) (r.ok ? toast.success : toast.error)(r.message);
          router.refresh();
        });
      }}
    >
      Remove
    </Button>
  );
}

export function SessionButtons() {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await signOutOthersAction();
            if (r.message) (r.ok ? toast.success : toast.error)(r.message);
          })
        }
      >
        Sign out other devices
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() => {
          if (!confirm("Sign out of every device, including this one?")) return;
          start(async () => {
            await signOutEverywhereAction();
          });
        }}
      >
        Sign out everywhere
      </Button>
    </div>
  );
}

export function RequireAdminMfaToggle({ on, enrolled }: { on: boolean; enrolled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="flex items-center gap-2">
        <ShieldCheck className="size-4" aria-hidden />
        {on
          ? "Owners and admins must use two-step verification."
          : "Two-step verification is optional for everyone."}
      </p>
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || (!on && !enrolled)}
          onClick={() =>
            start(async () => {
              const r = await setRequireAdminMfaAction(!on);
              if (r?.message) (r.ok ? toast.success : toast.error)(r.message);
              router.refresh();
            })
          }
        >
          {on ? "Stop requiring it" : "Require it for owners and admins"}
        </Button>
        {!on && !enrolled && (
          <span className="text-muted-foreground ml-2 text-xs">
            Set it up on your own account first.
          </span>
        )}
      </div>
    </div>
  );
}
