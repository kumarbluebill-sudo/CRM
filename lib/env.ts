import { z } from "zod";

/**
 * Public env: safe for the browser. Each variable must be referenced literally
 * (process.env.NEXT_PUBLIC_X) so Next.js can inline it into the client bundle.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export type PublicEnv = z.infer<typeof publicSchema>;

/** Treat empty strings (as in a copied .env.example) as unset. */
function blankToUndefined(value: string | undefined): string | undefined {
  return value && value.trim() !== "" ? value : undefined;
}

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: blankToUndefined(source.NEXT_PUBLIC_SUPABASE_URL),
    // Supabase now calls this the "publishable" key; older projects call it the "anon" key. Either name works.
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      blankToUndefined(source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
      blankToUndefined(source.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    NEXT_PUBLIC_APP_URL: blankToUndefined(source.NEXT_PUBLIC_APP_URL),
  });
}

export function getPublicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
}

export function isSupabaseConfigured(env: PublicEnv = getPublicEnv()): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
