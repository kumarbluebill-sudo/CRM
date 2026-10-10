import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import { CancelPlanButton, ChoosePlanButton } from "@/components/billing/billing-controls";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env.server";
import { pctUsed } from "@/lib/billing/limits";
import { getOrgLimits, getOrgUsage, listPlans } from "@/lib/billing/queries";
import { formatMoney } from "@/lib/quotation/pricing";

export const metadata: Metadata = { title: "Billing" };

const fmtDate = (v: string | null) => (v ? v.slice(0, 10) : "–");

function Meter({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number;
  unit?: string;
}) {
  const pct = pctUsed(used, limit);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {used.toLocaleString("en-IN")} / {limit.toLocaleString("en-IN")}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={pct >= 90 ? "h-full bg-tone-bad" : "bg-primary h-full"}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default async function BillingPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("settings.manage") && !session.permissions.has("billing.manage")) {
    return (
      <EmptyState
        icon={CreditCard}
        title="No access"
        description="Only owners and admins can view billing."
      />
    );
  }
  const canManage = session.permissions.has("billing.manage");
  const env = getServerEnv();
  const checkoutReady = Boolean(
    env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET,
  );
  const [l, usage, plans] = await Promise.all([getOrgLimits(), getOrgUsage(), listPlans()]);
  if (!l || !usage) {
    return (
      <EmptyState
        icon={CreditCard}
        title="Billing unavailable"
        description="Please try again shortly."
      />
    );
  }
  const current = plans.find((p) => p.key === l.planKey);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader title="Billing" description={session.organization.name} />

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3 text-base">
            <span>{current?.name ?? l.planKey} plan</span>
            <StatusBadge value={l.inForce ? l.status : "EXPIRED"} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {l.status === "TRIALING" && l.inForce && (
            <p>Free trial ends on {fmtDate(l.trialEndsAt)}.</p>
          )}
          {!l.inForce && (
            <p
              role="note"
              className="rounded-lg border border-tone-warn/30 bg-tone-warn-soft p-3 text-tone-warn"
            >
              Your trial or subscription has ended, so the Free plan&apos;s limits apply. Your data
              is safe and nothing has been deleted.
            </p>
          )}
          {l.status === "ACTIVE" && (
            <p>
              {l.cancelAtPeriodEnd
                ? `Ends on ${fmtDate(l.currentPeriodEnd)}.`
                : `Renews on ${fmtDate(l.currentPeriodEnd)}.`}
            </p>
          )}
          {l.status === "PAST_DUE" && (
            <p role="alert" className="text-destructive">
              The last payment didn&apos;t go through. Razorpay will retry; please check your
              payment method.
            </p>
          )}
          {l.pendingPlan && (
            <p className="text-muted-foreground">
              Checkout for the {l.pendingPlan} plan is waiting for payment confirmation.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Meter label="Team seats" used={usage.seats} limit={l.limits.seats} />
            <Meter
              label="Bookings this month"
              used={usage.bookingsThisMonth}
              limit={l.limits.bookingsPerMonth}
            />
            <Meter label="AI requests today" used={usage.aiOrgToday} limit={l.limits.aiOrgDaily} />
            <Meter
              label="Document storage"
              used={Math.round(usage.storageBytes / 1048576)}
              limit={l.limits.storageMb}
              unit="MB"
            />
          </div>
          {canManage && l.status === "ACTIVE" && !l.cancelAtPeriodEnd && (
            <div>
              <CancelPlanButton />
            </div>
          )}
        </CardContent>
      </Card>

      <section aria-label="Plans" className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.key === l.planKey && l.inForce && l.status !== "TRIALING";
          return (
            <Card key={p.key} className={isCurrent ? "border-primary" : undefined}>
              <CardHeader>
                <CardTitle className="text-base">{p.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <p className="text-2xl font-semibold">
                  {p.price_paise === 0 ? "Free" : formatMoney(p.price_paise / 100, p.currency)}
                  {p.price_paise > 0 && (
                    <span className="text-muted-foreground text-sm font-normal"> / month</span>
                  )}
                </p>
                <ul className="text-muted-foreground flex flex-col gap-1">
                  <li>{p.limits.seats} team seats</li>
                  <li>{p.limits.bookingsPerMonth.toLocaleString("en-IN")} bookings / month</li>
                  <li>{p.limits.aiOrgDaily} AI requests / day</li>
                  <li>
                    {(p.limits.storageMb / 1024).toFixed(p.limits.storageMb >= 1024 ? 0 : 1)} GB
                    documents
                  </li>
                </ul>
                {isCurrent ? (
                  <p className="font-medium">Current plan</p>
                ) : p.price_paise > 0 && canManage ? (
                  p.purchasable && checkoutReady ? (
                    <ChoosePlanButton planKey={p.key} label={`Choose ${p.name}`} />
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      Online checkout isn&apos;t available yet.
                    </p>
                  )
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </section>
      {!canManage && (
        <p className="text-muted-foreground text-sm">
          Only the organization owner can change the plan.
        </p>
      )}
    </div>
  );
}
