export type PlanLimits = {
  seats: number;
  bookingsPerMonth: number;
  aiOrgDaily: number;
  aiUserDaily: number;
  storageMb: number;
  /** A missing value means "no limit on this plan". */
  branches?: number;
  exportsPerMonth?: number;
};

export type OrgLimits = {
  planKey: string;
  status:
    | "TRIALING"
    | "ACTIVE"
    | "PAYMENT_PENDING"
    | "PAST_DUE"
    | "GRACE_PERIOD"
    | "CANCELLED"
    | "EXPIRED"
    | "SUSPENDED";
  /** False when the paid/trial period is over and the Free plan's limits apply. */
  inForce: boolean;
  limits: PlanLimits;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingPlan: string | null;
  graceEndsAt?: string | null;
  /** Suspended: everything can be read, nothing new can be created until payment succeeds. */
  readOnly?: boolean;
};

export type OrgUsage = {
  seats: number;
  branches?: number;
  exportsThisMonth?: number;
  bookingsThisMonth: number;
  aiOrgToday: number;
  storageBytes: number;
};

export type BannerKind =
  "TRIAL_ENDING" | "TRIAL_ENDED" | "PAST_DUE" | "GRACE" | "SUSPENDED" | "ENDING" | null;

/** Which notice (if any) the app shows to everyone in the organization. */
export function bannerFor(l: OrgLimits, now = Date.now()): { kind: BannerKind; days?: number } {
  if (l.status === "SUSPENDED") return { kind: "SUSPENDED" };
  if (l.status === "GRACE_PERIOD") {
    const days = l.graceEndsAt
      ? Math.max(Math.ceil((Date.parse(l.graceEndsAt) - now) / 86_400_000), 0)
      : undefined;
    return { kind: "GRACE", days };
  }
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

/** Names the limit that was hit, so the message tells the person what to do. */
export function limitMessage(dbMessage?: string): string {
  const m = /plan limit reached: (\w+)/.exec(dbMessage ?? "")?.[1];
  const what: Record<string, string> = {
    seats: "active staff accounts",
    branches: "branches",
    exports: "report exports this month",
    bookings: "bookings this month",
    storage: "document storage",
  };
  return m && what[m]
    ? `Your plan limit for ${what[m]} has been reached. An owner can upgrade under Settings → Billing.`
    : PLAN_LIMIT_MESSAGE;
}

export const PLAN_LIMIT_MESSAGE =
  "Your plan's limit has been reached. An owner can upgrade under Settings → Billing.";
