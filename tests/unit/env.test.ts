import { describe, expect, it } from "vitest";
import { isSupabaseConfigured, missingSupabaseVars, parsePublicEnv } from "@/lib/env";

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

  it("accepts the new publishable-key name, preferring it over the legacy anon name", () => {
    const only = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    });
    expect(only.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("sb_publishable_x");
    expect(isSupabaseConfigured(only)).toBe(true);
    const both = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "new",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "old",
    });
    expect(both.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("new");
  });

  it("tolerates whitespace and wrapping quotes from copy-pasted values", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: '  "https://abc.supabase.co"  ',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "'sb_publishable_x'",
    });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://abc.supabase.co");
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("sb_publishable_x");
    expect(isSupabaseConfigured(env)).toBe(true);
  });

  it("names the missing variables without values", () => {
    const onlyUrl = parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" });
    expect(missingSupabaseVars(onlyUrl)).toEqual(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
    expect(missingSupabaseVars(parsePublicEnv({}))).toHaveLength(2);
  });

  it("rejects a malformed URL", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url" })).toThrow();
  });
});
