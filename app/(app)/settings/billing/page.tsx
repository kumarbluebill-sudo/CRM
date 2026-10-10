import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import {
  CancelPlanButton,
  ChangePlanButton,
  ChoosePlanButton,
} from "@/components/billing/billing-controls";
import { LocalTime } from "@/components/datetime/local-time";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env.server";
import { pctUsed } from "@/lib/billing/limits";
import { getBillingHistory, getOrgLimits, getOrgUsage, listPlans } from "@/lib/billing/queries";
import { formatMoney } from "@/lib/quotation/pricing";
import { label } from "@/lib/crm/constants";

export const metadata: Metadata = { title: "Billing" };

const fmtDate = (v: string | null | undefined) => (v ? v.slice(0, 10) : "–");

function Meter({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number | undefined;
  unit?: string;
}) {
  const unlimited = limit === undefined;
  const pct = unlimited ? 0 : pctUsed(used, limit);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {used.toLocaleString("en-IN")} / {unlimited ? "no limit" : limit.toLocaleString("en-IN")}
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
          className={pct >= 90 ? "bg-tone-bad h-full" : "bg-primary h-full"}
          style={{ width: `${pct}%` }}
        />
      </div>
      {!unlimited && pct >= 90 && (
        <p className="text-tone-bad text-xs">
          {pct >= 100 ? "Limit reached." : "Almost at the limit."} Upgrade below to add more.
        </p>
      )}
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
  const [l, usage, plans, history] = await Promise.all([
    getOrgLimits(),
    getOrgUsage(),
    listPlans(),
    canManage ? getBillingHistory() : Promise.resolve(null),
  ]);
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
  const live = l.status === "ACTIVE" && l.inForce;
  const unpaid = ["PAST_DUE", "GRACE_PERIOD", "SUSPENDED"].includes(l.status);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title="Plan and billing"
        description={session.organization.name}
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Billing" }]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3 text-base">
            <span>{current?.name ?? l.planKey} plan</span>
            <StatusBadge value={l.inForce || unpaid ? l.status : "EXPIRED"} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {l.status === "TRIALING" && l.inForce && (
            <p>Free trial ends on {fmtDate(l.trialEndsAt)}.</p>
          )}
          {!l.inForce && !unpaid && l.status !== "PAYMENT_PENDING" && (
            <p
              role="note"
              className="border-tone-warn/30 bg-tone-warn-soft text-tone-warn rounded-lg border p-3"
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
              The last payment didn&apos;t go through. The payment provider will retry; please check
              your payment method.
            </p>
          )}
          {l.status === "GRACE_PERIOD" && (
            <p role="alert" className="text-destructive">
              Payment is overdue. Everything keeps working until {fmtDate(l.graceEndsAt)}, then the
              account becomes read-only. Nothing is deleted.
            </p>
          )}
          {l.status === "SUSPENDED" && (
            <p role="alert" className="text-destructive">
              Your account is read-only: you can view and download everything, but not add new
              records. It returns to normal as soon as a payment succeeds.
            </p>
          )}
          {l.status === "PAYMENT_PENDING" && (
            <p className="text-muted-foreground">
              Waiting for the payment provider to confirm your payment.
            </p>
          )}
          {l.pendingPlan && (
            <p className="text-muted-foreground">
              A change to the {plans.find((p) => p.key === l.pendingPlan)?.name ?? l.pendingPlan}{" "}
              plan is waiting for payment confirmation.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Meter label="Active staff accounts" used={usage.seats} limit={l.limits.seats} />
            <Meter label="Branches" used={usage.branches ?? 0} limit={l.limits.branches} />
            <Meter
              label="Bookings this month"
              used={usage.bookingsThisMonth}
              limit={l.limits.bookingsPerMonth}
            />
            <Meter
              label="Report exports this month"
              used={usage.exportsThisMonth ?? 0}
              limit={l.limits.exportsPerMonth}
            />
            <Meter label="AI requests today" used={usage.aiOrgToday} limit={l.limits.aiOrgDaily} />
            <Meter
              label="Document storage"
              used={Math.round(usage.storageBytes / 1048576)}
              limit={l.limits.storageMb}
              unit="MB"
            />
          </div>
          {canManage && live && !l.cancelAtPeriodEnd && (
            <div>
              <CancelPlanButton />
            </div>
          )}
        </CardContent>
      </Card>

      <section aria-label="Plans" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans
          .filter((p) => p.key !== "FREE")
          .map((p) => {
            const isCurrent = p.key === l.planKey && l.inForce && l.status !== "TRIALING";
            return (
              <Card key={p.key} className={isCurrent ? "border-primary" : undefined}>
                <CardHeader>
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  {p.description && (
                    <p className="text-muted-foreground text-xs">{p.description}</p>
                  )}
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3 text-sm">
                  <p className="text-2xl font-semibold tabular-nums">
                    {p.contactSales ? (
                      "Custom"
                    ) : (
                      <>
                        {formatMoney(p.price_paise / 100, p.currency)}
                        <span className="text-muted-foreground text-sm font-normal"> / month</span>
                      </>
                    )}
                  </p>
                  <ul className="text-muted-foreground flex flex-col gap-1">
                    {p.features.length > 0 ? (
                      p.features.map((f) => <li key={f}>{f}</li>)
                    ) : (
                      <>
                        <li>{p.limits.seats} staff accounts</li>
                        <li>
                          {p.limits.bookingsPerMonth.toLocaleString("en-IN")} bookings / month
                        </li>
                      </>
                    )}
                  </ul>
                  <ul className="text-muted-foreground border-t pt-2 text-xs">
                    <li>{p.limits.seats} active staff</li>
                    {p.limits.branches !== undefined && (
                      <li>
                        {p.limits.branches} branch{p.limits.branches === 1 ? "" : "es"}
                      </li>
                    )}
                    <li>
                      {(p.limits.storageMb / 1024).toFixed(p.limits.storageMb >= 1024 ? 0 : 1)} GB
                      documents
                    </li>
                  </ul>
                  <div className="mt-auto pt-1">
                    {isCurrent ? (
                      <p className="font-medium">Current plan</p>
                    ) : p.contactSales ? (
                      <p className="text-muted-foreground text-xs">
                        Contact us for custom limits and onboarding.
                      </p>
                    ) : canManage ? (
                      p.purchasable && checkoutReady ? (
                        live ? (
                          <ChangePlanButton
                            planKey={p.key}
                            label={
                              p.price_paise > (current?.price_paise ?? 0)
                                ? `Upgrade to ${p.name}`
                                : `Switch to ${p.name}`
                            }
                          />
                        ) : (
                          <ChoosePlanButton planKey={p.key} label={`Choose ${p.name}`} />
                        )
                      ) : (
                        <p className="text-muted-foreground text-xs">
                          Online checkout isn&apos;t available yet.
                        </p>
                      )
                    ) : null}
                  </div>
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

      {history && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment history</CardTitle>
          </CardHeader>
          <CardContent>
            {history.payments.length === 0 ? (
              <p className="text-muted-foreground text-sm">No payments yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="px-3 py-2.5">Date</th>
                      <th className="px-3 py-2.5">Plan</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5 text-right">Amount</th>
                      <th className="px-3 py-2.5">Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2.5">
                          <LocalTime value={p.at} dateOnly />
                        </td>
                        <td className="px-3 py-2.5">{p.plan ? label(p.plan) : "–"}</td>
                        <td className="px-3 py-2.5">
                          <StatusBadge
                            value={
                              p.status === "CAPTURED"
                                ? "PAID"
                                : p.status === "FAILED"
                                  ? "FAILED"
                                  : "PARTIAL"
                            }
                          />
                          {p.refundedPaise > 0 && (
                            <span className="text-muted-foreground ml-2 text-xs">
                              {formatMoney(p.refundedPaise / 100, p.currency)} refunded
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatMoney(p.amountPaise / 100, p.currency)}
                        </td>
                        <td className="px-3 py-2.5">
                          {p.receiptId ? (
                            <a
                              className="text-primary underline"
                              href={`/api/billing/receipt/${p.receiptId}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {p.receiptNumber}
                            </a>
                          ) : (
                            "–"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {history.events.length > 0 && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-medium">Subscription history</summary>
                <ul className="text-muted-foreground mt-2 flex flex-col gap-1">
                  {history.events.map((e, i) => (
                    <li key={i}>
                      <LocalTime value={e.at} /> · {e.from ? `${label(e.from)} → ` : ""}
                      {e.to ? label(e.to) : label(e.kind)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
