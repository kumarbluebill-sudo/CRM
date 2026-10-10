import Link from "next/link";
import { bannerFor } from "@/lib/billing/limits";
import { getOrgLimits } from "@/lib/billing/queries";

const TEXT = {
  TRIAL_ENDING: (d?: number) =>
    `Your free trial ends ${d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`}.`,
  TRIAL_ENDED: () => "Your trial or plan has ended, so Free plan limits apply.",
  PAST_DUE: () => "Your last subscription payment didn't go through.",
  ENDING: () => "Your plan is set to end at the close of this billing period.",
} as const;

/** One calm notice at the top of the app. Never blocks work and never throws: billing trouble must not take the CRM down. */
export async function BillingBanner() {
  let notice: ReturnType<typeof bannerFor> = { kind: null };
  try {
    const l = await getOrgLimits();
    if (l) notice = bannerFor(l);
  } catch {
    return null;
  }
  if (!notice.kind) return null;
  return (
    <div
      role="status"
      className="border-tone-warn/30 bg-tone-warn-soft text-tone-warn flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm"
    >
      <span>{TEXT[notice.kind](notice.days)}</span>
      <Link href="/settings/billing" className="font-medium underline">
        View billing
      </Link>
    </div>
  );
}
