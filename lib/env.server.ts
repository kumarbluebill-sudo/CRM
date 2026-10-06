import "server-only";
import { z } from "zod";
import { logger } from "@/lib/utils/logger";

/**
 * Server-only secrets. Importing this file from a client component fails the
 * build (server-only). Values are optional in Phase 1 and become required by
 * the phase that uses them.
 */
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().email().optional(),
  CRON_SECRET: z.string().min(16).optional(),
  ENCRYPTION_KEY: z.string().min(40).optional(),
  APP_ENV: z.enum(["development", "preview", "production"]).optional(),
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  SENTRY_DSN: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

/**
 * Validates each variable on its own. A malformed OPTIONAL value (a typo in a URL, a too-short secret) is treated as
 * "not set" and reported by name only, instead of throwing: otherwise one bad variable would turn the health check,
 * webhooks and cron into 500s. Features that need the value then behave as unconfigured and fail closed.
 */
export function parseServerEnv(source: Record<string, string | undefined>): {
  env: ServerEnv;
  invalid: string[];
} {
  const env: Record<string, unknown> = {};
  const invalid: string[] = [];
  for (const [key, schema] of Object.entries(serverSchema.shape)) {
    const raw = source[key];
    if (!raw || raw.trim() === "") continue;
    const r = schema.safeParse(raw);
    if (r.success) env[key] = r.data;
    else invalid.push(key);
  }
  return { env: env as ServerEnv, invalid };
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (!cached) {
    const { env, invalid } = parseServerEnv(process.env);
    if (invalid.length) logger.warn("ignoring malformed environment variables", { names: invalid });
    cached = env;
  }
  return cached;
}
