"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPublicEnv, isSupabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/utils/logger";
import {
  forgotPasswordSchema,
  loginSchema,
  organizationSchema,
  profileSchema,
  registerSchema,
  resetPasswordSchema,
  type FormState,
} from "@/lib/auth/schemas";
import { getSessionContext } from "@/lib/auth/session";

const NOT_CONFIGURED: FormState = {
  message: "The service is not configured yet. Please contact support.",
};
const GENERIC: FormState = { message: "Something went wrong. Please try again." };

function formObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    logger.warn("login failed", { code: error.code });
    // Same message for unknown user / wrong password to avoid account enumeration.
    return {
      message:
        error.code === "email_not_confirmed"
          ? "Please verify your email first. Check your inbox."
          : "Invalid email or password.",
    };
  }
  redirect("/dashboard");
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${getPublicEnv().NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });
  if (error) {
    logger.warn("register failed", { code: error.code });
    if (error.code === "weak_password") return { fieldErrors: { password: [error.message] } };
    return GENERIC;
  }
  // Identical response whether or not the email already exists.
  return {
    ok: true,
    message: "Check your email to verify your account, then sign in.",
  };
}

export async function forgotPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getPublicEnv().NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`,
  });
  if (error) logger.warn("password reset request failed", { code: error.code });
  return { ok: true, message: "If an account exists for that email, a reset link is on its way." };
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "This reset link has expired. Request a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    logger.warn("password update failed", { code: error.code });
    return error.code === "weak_password"
      ? { fieldErrors: { password: [error.message] } }
      : GENERIC;
  }
  redirect("/dashboard");
}

export async function logoutAction() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

export async function createOrganizationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = organizationSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (session.organization) redirect("/dashboard");

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", { org_name: parsed.data.name });
  if (error) {
    logger.error("create_organization failed", { error: error.message });
    return GENERIC;
  }
  redirect("/dashboard");
}

export async function updateProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = profileSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const session = await getSessionContext();
  if (!session) redirect("/login");

  const supabase = await createClient();
  // The row is selected by the verified user id; RLS also restricts to own row.
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName, phone: parsed.data.phone || null })
    .eq("id", session.userId);
  if (error) {
    logger.error("profile update failed", { error: error.message });
    return GENERIC;
  }
  return { ok: true, message: "Profile saved." };
}
