#!/usr/bin/env node
/**
 * Pre-deploy configuration check. Reads process.env (set the variables, or load a file with
 * `node --env-file=.env.production scripts/check-env.mjs`). Prints only variable NAMES, never values.
 * Exit code 1 if a required variable is missing or malformed.
 */
const env = process.env;
const has = (k) => Boolean(env[k] && env[k].trim());
const b64len = (k) => {
  try {
    return Buffer.from(env[k] ?? "", "base64").length;
  } catch {
    return 0;
  }
};

const groups = [
  {
    name: "Core (required)",
    required: true,
    checks: [
      [
        "NEXT_PUBLIC_SUPABASE_URL",
        () => /^https:\/\/.+/.test(env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
        "https URL of the Supabase project",
      ],
      [
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        () => has("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") || has("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
        "Supabase publishable key (or legacy anon key)",
      ],
      [
        "SUPABASE_SERVICE_ROLE_KEY",
        () => has("SUPABASE_SERVICE_ROLE_KEY"),
        "server only: storage, portal, webhooks, cron",
      ],
      [
        "NEXT_PUBLIC_APP_URL",
        () => /^https:\/\/[^/]+$/.test(env.NEXT_PUBLIC_APP_URL ?? ""),
        "https origin without a trailing slash (used in links and CSRF checks)",
      ],
      [
        "ENCRYPTION_KEY",
        () => b64len("ENCRYPTION_KEY") === 32,
        "32 random bytes, base64: encrypts agencies' Razorpay keys",
      ],
      [
        "CRON_SECRET",
        () => (env.CRON_SECRET ?? "").length >= 16,
        "min 16 chars; protects /api/cron/* and deep health check",
      ],
    ],
  },
  {
    name: "Rate limiting (required in production)",
    required: true,
    checks: [
      [
        "UPSTASH_REDIS_REST_URL",
        () => /^https:\/\/.+/.test(env.UPSTASH_REDIS_REST_URL ?? ""),
        "shared limits across serverless instances",
      ],
      ["UPSTASH_REDIS_REST_TOKEN", () => has("UPSTASH_REDIS_REST_TOKEN"), ""],
    ],
  },
  {
    name: "Platform billing (required to sell subscriptions)",
    required: false,
    checks: [
      [
        "RAZORPAY_KEY_ID",
        () => /^rzp_(test|live)_/.test(env.RAZORPAY_KEY_ID ?? ""),
        "the PLATFORM's Razorpay account",
      ],
      ["RAZORPAY_KEY_SECRET", () => has("RAZORPAY_KEY_SECRET"), ""],
      [
        "RAZORPAY_WEBHOOK_SECRET",
        () => has("RAZORPAY_WEBHOOK_SECRET"),
        "for /api/webhooks/razorpay (subscription events)",
      ],
    ],
  },
  {
    name: "Email (required for invitations and customer email)",
    required: false,
    checks: [
      ["RESEND_API_KEY", () => has("RESEND_API_KEY"), ""],
      [
        "EMAIL_FROM",
        () => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.EMAIL_FROM ?? ""),
        "a Resend-verified sender address",
      ],
    ],
  },
  {
    name: "Optional",
    required: false,
    checks: [
      ["OPENAI_API_KEY", () => has("OPENAI_API_KEY"), "AI assistant and AI itinerary import"],
      [
        "SENTRY_DSN",
        () => /^https:\/\/[^@]+@[^/]+\/\d+$/.test(env.SENTRY_DSN ?? ""),
        "error reporting",
      ],
    ],
  },
];

let failed = false;
for (const g of groups) {
  console.log(`\n${g.name}`);
  for (const [name, ok, note] of g.checks) {
    const good = ok();
    if (!good && g.required) failed = true;
    console.log(
      `  ${good ? "ok     " : g.required ? "MISSING" : "not set"}  ${name}${note ? `  (${note})` : ""}`,
    );
  }
}
if (env.NEXT_PUBLIC_APP_URL?.includes("localhost")) {
  console.log("\nWARNING: NEXT_PUBLIC_APP_URL points at localhost.");
}
console.log(
  failed ? "\nNot ready: fix the MISSING items above." : "\nRequired configuration looks complete.",
);
process.exit(failed ? 1 : 0);
