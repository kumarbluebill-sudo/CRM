import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import { EntityForm } from "@/components/forms/entity-form";
import { RemovePaymentSettingsButton } from "@/components/settings/remove-payment-settings";
import { PageHeader } from "@/components/crm/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { getPublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { savePaymentSettingsAction } from "@/app/(app)/settings/payments/actions";

export const metadata: Metadata = { title: "Online payments" };

export default async function PaymentSettingsPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("settings.manage")) {
    return (
      <EmptyState
        icon={CreditCard}
        title="No access"
        description="Only owners and admins can change payment settings."
      />
    );
  }
  const supabase = await createClient();
  const { data } = await supabase.rpc("payment_settings_status");
  const status = (data ?? { configured: false }) as {
    configured: boolean;
    mode?: string;
    keyIdHint?: string;
    updatedAt?: string;
  };
  const webhookUrl = `${getPublicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/webhooks/razorpay/${session.organization.id}`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Online payments"
        description="Connect your agency's own Razorpay account. Customer payments go straight to you."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {status.configured ? (
            <>
              <p>
                Connected in <strong>{status.mode}</strong> mode (key ending {status.keyIdHint}),
                updated {status.updatedAt?.slice(0, 10)}.
              </p>
              <div>
                <RemovePaymentSettingsButton />
              </div>
            </>
          ) : (
            <p>Not connected. Online payment buttons stay hidden until you connect Razorpay.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            In the Razorpay dashboard go to Settings → Webhooks → Add, and use this URL with the
            secret you enter below. Enable <code>payment.captured</code>,{" "}
            <code>payment.failed</code> and <code>order.paid</code>.
          </p>
          <code className="bg-muted block rounded-lg p-2 text-xs break-all">{webhookUrl}</code>
          <p className="text-muted-foreground">
            Payments are only marked paid when this webhook arrives with a valid signature.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {status.configured ? "Replace credentials" : "Connect Razorpay"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            Keys are checked with Razorpay, then stored encrypted. They can&apos;t be viewed again
            by anyone.
          </p>
          <EntityForm
            action={savePaymentSettingsAction}
            submitLabel={status.configured ? "Replace credentials" : "Connect"}
            fields={[
              { name: "keyId", label: "Key id", required: true, placeholder: "rzp_live_…" },
              { name: "keySecret", label: "Key secret", required: true, type: "password" },
              {
                name: "webhookSecret",
                label: "Webhook secret (you choose it; paste the same one in Razorpay)",
                required: true,
                type: "password",
                wide: true,
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
