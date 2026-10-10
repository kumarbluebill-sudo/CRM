import type { Metadata } from "next";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm, type FormField } from "@/components/forms/entity-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { createClient } from "@/lib/supabase/server";
import { saveBillingSettingsAction, savePlanAction } from "@/app/admin/actions";

export const metadata: Metadata = { title: "Plans" };

type AdminPlan = {
  key: string;
  name: string;
  pricePaise: number;
  description: string | null;
  limits: Record<string, number>;
  features: string[];
  active: boolean;
  isPublic: boolean;
  contactSales: boolean;
  razorpayPlanId: string | null;
  sort: number;
  organizations: number;
};

const fields = (p?: AdminPlan): FormField[] => [
  {
    name: "key",
    label: "Plan key (capitals)",
    required: true,
    defaultValue: p?.key,
    placeholder: "GROWTH",
  },
  { name: "name", label: "Name", required: true, defaultValue: p?.name },
  { name: "description", label: "Short description", wide: true, defaultValue: p?.description },
  {
    name: "priceRupees",
    label: "Price per month (₹)",
    type: "number",
    required: true,
    step: "1",
    min: 0,
    defaultValue: p ? p.pricePaise / 100 : 0,
  },
  { name: "sort", label: "Display order", type: "number", min: 0, defaultValue: p?.sort ?? 10 },
  {
    name: "seats",
    label: "Active staff accounts",
    type: "number",
    min: 0,
    defaultValue: p?.limits.seats,
  },
  { name: "branches", label: "Branches", type: "number", min: 0, defaultValue: p?.limits.branches },
  {
    name: "bookingsPerMonth",
    label: "Bookings per month",
    type: "number",
    min: 0,
    defaultValue: p?.limits.bookingsPerMonth,
  },
  {
    name: "storageMb",
    label: "Document storage (MB)",
    type: "number",
    min: 0,
    defaultValue: p?.limits.storageMb,
  },
  {
    name: "exportsPerMonth",
    label: "Report exports per month",
    type: "number",
    min: 0,
    defaultValue: p?.limits.exportsPerMonth,
  },
  {
    name: "aiOrgDaily",
    label: "AI requests per day (agency)",
    type: "number",
    min: 0,
    defaultValue: p?.limits.aiOrgDaily,
  },
  {
    name: "aiUserDaily",
    label: "AI requests per day (person)",
    type: "number",
    min: 0,
    defaultValue: p?.limits.aiUserDaily,
  },
  {
    name: "features",
    label: "Features shown to customers (one per line)",
    type: "textarea",
    wide: true,
    defaultValue: p?.features.join("\n"),
  },
  {
    name: "razorpayPlanId",
    label: "Payment provider plan id (plan_...)",
    defaultValue: p?.razorpayPlanId,
  },
  {
    name: "active",
    label: "Available to choose",
    type: "checkbox",
    defaultValue: p?.active ?? true,
  },
  {
    name: "isPublic",
    label: "Shown on the billing page",
    type: "checkbox",
    defaultValue: p?.isPublic ?? true,
  },
  {
    name: "contactSales",
    label: "Contact sales (no online checkout)",
    type: "checkbox",
    defaultValue: p?.contactSales ?? false,
  },
];

export default async function AdminPlansPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const [{ data: plans }, { data: cfg }] = await Promise.all([
    supabase.rpc("admin_plans"),
    supabase.rpc("admin_billing_settings"),
  ]);
  const settings = (cfg ?? { graceDays: 7, pastDueDays: 3, trialDays: 14 }) as {
    graceDays: number;
    pastDueDays: number;
    trialDays: number;
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Plans"
        description="Prices, limits and features are editable at any time. Existing subscribers keep working; a new price applies when a plan is next purchased. Prices shown here are placeholders until you set them."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Billing rules</CardTitle>
          <p className="text-muted-foreground text-xs">
            Days of retry before the grace period starts, days of grace before the account turns
            read-only, and the length of the free trial for new agencies.
          </p>
        </CardHeader>
        <CardContent>
          <EntityForm
            action={saveBillingSettingsAction}
            submitLabel="Save rules"
            fields={[
              {
                name: "pastDueDays",
                label: "Retry days before grace",
                type: "number",
                min: 0,
                defaultValue: settings.pastDueDays,
              },
              {
                name: "graceDays",
                label: "Grace period (days)",
                type: "number",
                min: 0,
                defaultValue: settings.graceDays,
              },
              {
                name: "trialDays",
                label: "Free trial (days)",
                type: "number",
                min: 0,
                defaultValue: settings.trialDays,
              },
            ]}
          />
        </CardContent>
      </Card>
      {((plans ?? []) as AdminPlan[]).map((p) => (
        <Card key={p.key}>
          <CardHeader>
            <CardTitle className="text-base">
              {p.name}{" "}
              <span className="text-muted-foreground text-xs font-normal">
                · {p.key} · {p.organizations} agencies
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EntityForm action={savePlanAction} submitLabel="Save plan" fields={fields(p)} />
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New plan</CardTitle>
        </CardHeader>
        <CardContent>
          <EntityForm action={savePlanAction} submitLabel="Create plan" fields={fields()} />
        </CardContent>
      </Card>
    </div>
  );
}
