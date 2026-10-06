import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicEnv, isSupabaseConfigured } from "@/lib/env";

/** Only same-site relative paths are allowed, to prevent open redirects. */
function safeNext(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) {
    return value;
  }
  return "/dashboard";
}

// Handles email verification and password-reset links (PKCE code exchange).
export async function GET(request: NextRequest) {
  const base = getPublicEnv().NEXT_PUBLIC_APP_URL;
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(request.nextUrl.searchParams.get("next"));

  if (code && isSupabaseConfigured()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, base));
  }
  return NextResponse.redirect(new URL("/login?error=link", base));
}
