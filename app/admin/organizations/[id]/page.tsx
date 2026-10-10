import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/datetime/local-time";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { label } from "@/lib/crm/constants";
import { uuid } from "@/lib/crm/schemas";
import { formatMoney } from "@/lib/quotation/pricing";
import { createClient } from "@/lib/supabase/server";
import { adminChangeSubscriptionAction, refundPaymentAction } from "@/app/admin/actions";

export const metadata: Metadata = { title: "Agency" };

type Detail = {
  subscription: {
    plan_key: string;
    status: string;
    current_period_end: string | null;
    grace_ends_at: string | null;
    trial_ends_at: string | null;
  } | null;
  payments: {
    id: string;
    status: string;
    amountPaise: number;
    refundedPaise: number;
    currency: string;
    plan: string | null;
    at: string;
  }[];
  events: {
    kind: string;
    from: string | null;
    to: string | null;
    detail: Record<string, unknown>;
    at: string;
  }[];
};

export default async function AdminOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data }, { data: plans }, { data: orgs }] = await Promise.all([
    supabase.rpc("admin_org_detail", { p_org: id }),
    supabase.rpc("admin_plans"),
    supabase.rpc("admin_organizations", { p_search: null, p_limit: 200, p_offset: 0 }),
  ]);
  const org = ((orgs ?? []) as { id: string; name: string }[]).find((o) => o.id === id);
  const d = data as Detail | null;
  if (!d?.subscription || !org) notFound();
  const s = d.subscription;
  const planOptions = [
    { value: "", label: "Keep current plan" },
    ...((plans ?? []) as { key: string; name: string }[]).map((p) => ({
      value: p.key,
      label: p.name,
    })),
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={org.name}
        description="Subscription, payments and history."
        breadcrumb={[{ label: "Agencies", href: "/admin/organizations" }, { label: org.name }]}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-base">
            {label(s.plan_key)} <StatusBadge value={s.status} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            {s.current_period_end && (
              <>
                Period ends <LocalTime value={s.current_period_end} dateOnly />.{" "}
              </>
            )}
            {s.grace_ends_at && (
              <>
                Grace ends <LocalTime value={s.grace_ends_at} dateOnly />.{" "}
              </>
            )}
            {s.trial_ends_at && (
              <>
                Trial ends <LocalTime value={s.trial_ends_at} dateOnly />.
              </>
            )}
          </p>
          <div>
            <h2 className="mb-2 text-sm font-semibold">Change manually</h2>
            <p className="text-muted-foreground mb-3 text-xs">
              Follows the same allowed status moves as automatic changes. A reason is required and
              is recorded with your account. You will be asked to confirm your password.
            </p>
            <EntityForm
              action={adminChangeSubscriptionAction.bind(null, id)}
              submitLabel="Apply change"
              fields={[
                {
                  name: "plan",
                  label: "Plan",
                  type: "select",
                  options: planOptions,
                  defaultValue: "",
                },
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  options: [
                    { value: "", label: "Keep current status" },
                    ...[
                      "ACTIVE",
                      "SUSPENDED",
                      "EXPIRED",
                      "CANCELLED",
                      "GRACE_PERIOD",
                      "PAYMENT_PENDING",
                    ].map((v) => ({
                      value: v,
                      label: label(v),
                    })),
                  ],
                  defaultValue: "",
                },
                { name: "reason", label: "Reason", required: true, wide: true },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {d.payments.length === 0 && (
            <p className="text-muted-foreground text-sm">No payments yet.</p>
          )}
          {d.payments.map((p) => (
            <div key={p.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <LocalTime value={p.at} dateOnly />
                <span>{p.plan ? label(p.plan) : "–"}</span>
                <StatusBadge
                  value={
                    p.status === "CAPTURED" ? "PAID" : p.status === "FAILED" ? "FAILED" : "PARTIAL"
                  }
                />
                <span className="ml-auto font-medium tabular-nums">
                  {formatMoney(p.amountPaise / 100, p.currency)}
                </span>
              </div>
              {p.refundedPaise > 0 && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {formatMoney(p.refundedPaise / 100, p.currency)} refunded
                </p>
              )}
              {(p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED") && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium">Refund</summary>
                  <div className="pt-2">
                    <EntityForm
                      action={refundPaymentAction.bind(null, id, p.id)}
                      submitLabel="Refund via payment provider"
                      fields={[
                        {
                          name: "rupees",
                          label: "Amount (₹)",
                          type: "number",
                          required: true,
                          step: "0.01",
                          min: 0,
                          defaultValue: (p.amountPaise - p.refundedPaise) / 100,
                        },
                        { name: "reason", label: "Reason", required: true },
                      ]}
                    />
                  </div>
                </details>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
            {d.events.map((e, i) => (
              <li key={i}>
                <LocalTime value={e.at} /> · {label(e.kind)}
                {e.from || e.to
                  ? `: ${e.from ? `${label(e.from)} → ` : ""}${e.to ? label(e.to) : ""}`
                  : ""}
                {typeof e.detail?.reason === "string" ? ` (${e.detail.reason})` : ""}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
