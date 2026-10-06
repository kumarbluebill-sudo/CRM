export type PlanLimits = {
  seats: number;
  bookingsPerMonth: number;
  aiOrgDaily: number;
  aiUserDaily: number;
  storageMb: number;
};

export type OrgLimits = {
  planKey: string;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "EXPIRED";
  /** False when the paid/trial period is over and the Free plan's limits apply. */
  inForce: boolean;
  limits: PlanLimits;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingPlan: string | null;
};

export type OrgUsage = {
  seats: number;
  bookingsThisMonth: number;
  aiOrgToday: number;
  storageBytes: number;
};

export type BannerKind = "TRIAL_ENDING" | "TRIAL_ENDED" | "PAST_DUE" | "ENDING" | null;

/** Which notice (if any) the app shows to everyone in the organization. */
export function bannerFor(l: OrgLimits, now = Date.now()): { kind: BannerKind; days?: number } {
  if (l.status === "PAST_DUE") return { kind: "PAST_DUE" };
  if (!l.inForce) return { kind: "TRIAL_ENDED" };
  if (l.status === "TRIALING" && l.trialEndsAt) {
    const days = Math.ceil((Date.parse(l.trialEndsAt) - now) / 86_400_000);
    if (days <= 5) return { kind: "TRIAL_ENDING", days: Math.max(days, 0) };
  }
  if (l.cancelAtPeriodEnd || l.status === "CANCELLED") return { kind: "ENDING" };
  return { kind: null };
}

export const pctUsed = (used: number, limit: number) =>
  limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;

export const PLAN_LIMIT_MESSAGE =
  "Your plan's limit has been reached. An owner can upgrade under Settings → Billing.";
