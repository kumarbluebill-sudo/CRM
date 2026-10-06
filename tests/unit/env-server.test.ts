import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env.server";

describe("parseServerEnv", () => {
  it("keeps valid values and treats blanks as unset", () => {
    const { env, invalid } = parseServerEnv({
      RESEND_API_KEY: "re_123",
      OPENAI_API_KEY: "   ",
      EMAIL_FROM: "bookings@agency.com",
    });
    expect(env).toEqual({ RESEND_API_KEY: "re_123", EMAIL_FROM: "bookings@agency.com" });
    expect(invalid).toEqual([]);
  });

  it("drops a malformed optional value and reports only its name, never throwing", () => {
    const { env, invalid } = parseServerEnv({
      UPSTASH_REDIS_REST_URL: "not a url",
      SENTRY_DSN: "also bad",
      CRON_SECRET: "short",
      ENCRYPTION_KEY: "tooshort",
      APP_ENV: "staging",
      RAZORPAY_WEBHOOK_SECRET: "fine-secret",
    });
    expect(env).toEqual({ RAZORPAY_WEBHOOK_SECRET: "fine-secret" });
    expect(invalid.sort()).toEqual(
      ["APP_ENV", "CRON_SECRET", "ENCRYPTION_KEY", "SENTRY_DSN", "UPSTASH_REDIS_REST_URL"].sort(),
    );
  });

  it("never includes values in the invalid list (they may be secrets)", () => {
    const { invalid } = parseServerEnv({ CRON_SECRET: "super-secret" });
    expect(JSON.stringify(invalid)).not.toContain("super-secret");
  });
});
