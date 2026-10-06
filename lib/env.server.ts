import "server-only";
import { z } from "zod";

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

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (!cached) {
    const entries = Object.keys(serverSchema.shape).map((key) => {
      const value = process.env[key];
      return [key, value && value.trim() !== "" ? value : undefined] as const;
    });
    cached = serverSchema.parse(Object.fromEntries(entries));
  }
  return cached;
}
