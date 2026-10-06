import { describe, expect, it } from "vitest";
import { isSupabaseConfigured, parsePublicEnv } from "@/lib/env";

describe("parsePublicEnv", () => {
  it("applies defaults and treats blank values as unset", () => {
    const env = parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_APP_URL: "" });
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(isSupabaseConfigured(env)).toBe(false);
  });

  it("detects a configured Supabase project", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    });
    expect(isSupabaseConfigured(env)).toBe(true);
  });

  it("rejects a malformed URL", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url" })).toThrow();
  });
});
