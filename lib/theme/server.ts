import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { parseTheme, type Theme } from "@/lib/theme/schema";

export type StoredThemes = {
  /** The signed-in person's own choice, or null when they follow the agency. */
  user: Theme | null;
  /** The agency default, or null when none is set. */
  org: Theme | null;
};

/**
 * Reads the saved themes under the user's own session, so row-level security keeps every agency's settings private.
 * Anything that fails validation counts as "not set", which falls back to the look that ships with the app.
 */
export const getStoredThemes = cache(async (): Promise<StoredThemes> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { user: null, org: null };
    const [{ data: profile }, { data: org }] = await Promise.all([
      supabase.from("profiles").select("theme").eq("id", user.id).maybeSingle(),
      supabase.from("organization_settings").select("theme").maybeSingle(),
    ]);
    return { user: parseTheme(profile?.theme), org: parseTheme(org?.theme) };
  } catch {
    return { user: null, org: null };
  }
});

/** What is applied to the page: the person's own theme, else the agency's, else nothing. */
export async function getEffectiveTheme(): Promise<Theme | null> {
  const t = await getStoredThemes();
  return t.user ?? t.org;
}
