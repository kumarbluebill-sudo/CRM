import { describe, expect, it } from "vitest";
import { redact } from "@/lib/utils/logger";

describe("redact", () => {
  it("redacts sensitive keys at any depth", () => {
    const out = redact({
      user: "a",
      password: "p",
      nested: { apiKey: "k", passport_number: "X123", ok: 1 },
      list: [{ access_token: "t" }],
    }) as {
      user: string;
      password: string;
      nested: Record<string, unknown>;
      list: Record<string, unknown>[];
    };
    expect(out.user).toBe("a");
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested.apiKey).toBe("[REDACTED]");
    expect(out.nested.passport_number).toBe("[REDACTED]");
    expect(out.nested.ok).toBe(1);
    expect(out.list[0].access_token).toBe("[REDACTED]");
  });
});
