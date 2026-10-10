import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MfaSetup,
  RemoveFactorButton,
  RequireAdminMfaToggle,
  SessionButtons,
} from "@/components/security/mfa-setup";
import { requireOrgSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ required?: string }>;
}) {
  const session = await requireOrgSession();
  const supabase = await createClient();
  const [{ data: factors }, { data: settings }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.from("organization_settings").select("require_admin_mfa").maybeSingle(),
  ]);
  const verified = (factors?.totp ?? []).filter((f) => f.status === "verified");
  const enrolled = verified.length > 0;
  const policy = Boolean(settings?.require_admin_mfa);
  const required = (await searchParams).required === "1";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account security</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {session.email} ·{" "}
          <Link href="/profile" className="underline">
            Back to profile
          </Link>
        </p>
      </div>
      {required && !enrolled && (
        <p
          role="alert"
          className="rounded-lg border border-tone-warn/30 bg-tone-warn-soft p-3 text-sm text-tone-warn"
        >
          Your agency requires owners and admins to use two-step verification. Set it up below to
          continue.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Two-step verification</CardTitle>
          <p className="text-muted-foreground text-xs">
            After your password, you also enter a 6-digit code from an authenticator app. Even if
            someone learns your password, they can&apos;t get in without your phone.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {enrolled ? (
            <ul className="divide-y text-sm">
              {verified.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium">{f.friendly_name ?? "Authenticator app"}</span>
                  <span className="text-xs text-tone-ok">On</span>
                  <span className="text-muted-foreground text-xs">
                    added {f.created_at.slice(0, 10)}
                  </span>
                  <span className="ml-auto">
                    <RemoveFactorButton id={f.id} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <MfaSetup />
          )}
        </CardContent>
      </Card>

      {session.permissions.has("settings.manage") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agency policy</CardTitle>
          </CardHeader>
          <CardContent>
            <RequireAdminMfaToggle on={policy} enrolled={enrolled} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Devices and sessions</CardTitle>
          <p className="text-muted-foreground text-xs">
            Lost a phone or used a shared computer? Sign out everywhere, then change your password.
            Sessions also end by themselves after a long period of inactivity.
          </p>
        </CardHeader>
        <CardContent>
          <SessionButtons />
        </CardContent>
      </Card>
    </div>
  );
}
