"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPublicEnv, isSupabaseConfigured, missingSupabaseVars } from "@/lib/env";
import { logger } from "@/lib/utils/logger";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/utils/request";
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
import { safeNext } from "@/lib/auth/recent";
import { logSecurityEvent } from "@/lib/security/log";

const NOT_CONFIGURED: FormState = {
  message: "The service is not configured yet. Please contact support.",
};
const GENERIC: FormState = { message: "Something went wrong. Please try again." };
const TOO_MANY: FormState = {
  message: "Too many attempts. Please wait a few minutes and try again.",
};

function formObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  if (!isSupabaseConfigured()) {
    logger.error("supabase not configured", { missing: missingSupabaseVars() });
    return NOT_CONFIGURED;
  }

  // Throttle by address AND by target account, so neither one attacker nor a spread-out attack can guess passwords freely.
  const ip = await clientIp();
  const email = parsed.data.email.toLowerCase();
  const [byIp, byEmail] = await Promise.all([
    rateLimit(`login-ip:${ip}`, 20, 10 * 60_000),
    rateLimit(`login-email:${email}`, 8, 10 * 60_000),
  ]);
  if (!byIp.allowed || !byEmail.allowed) {
    logger.warn("login throttled", { ip });
    await logSecurityEvent("LOGIN_THROTTLED", email, ip);
    return TOO_MANY;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    logger.warn("login failed", { code: error.code });
    await logSecurityEvent(
      "LOGIN_FAILED",
      email,
      ip,
      error.code === "email_not_confirmed" ? "e-mail not confirmed" : "wrong password",
    );
    // Same message for unknown user / wrong password to avoid account enumeration.
    return {
      message:
        error.code === "email_not_confirmed"
          ? "Please verify your email first. Check your inbox."
          : "Invalid email or password.",
    };
  }
  // A person with an authenticator still has to complete the second step before they can see anything.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") redirect("/login/mfa");
  if (data.user) await audit(supabase, "LOGIN", "user", data.user.id); // no-op until the user belongs to an organization
  redirect("/dashboard");
}

const CODE_ERROR: FormState = {
  fieldErrors: { code: ["Enter the 6-digit code from your authenticator app."] },
};

/** Second step of sign-in: checks the 6-digit code, throttled per person and per address. */
export async function verifyMfaAction(
  next: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const code = String(formData.get("code") ?? "").replace(/s/g, "");
  if (!/^[0-9]{6}$/.test(code)) return CODE_ERROR;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const ip = await clientIp();
  const [byUser, byIp] = await Promise.all([
    rateLimit(`mfa-user:${user.id}`, 6, 5 * 60_000),
    rateLimit(`mfa-ip:${ip}`, 30, 5 * 60_000),
  ]);
  if (!byUser.allowed || !byIp.allowed) return TOO_MANY;

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) redirect(safeNext(next));
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    await supabase.rpc("log_my_security_event", { p_kind: "MFA_FAILED", p_ip: ip });
    return { message: "That code didn't work. Check the code and try again." };
  }
  await audit(supabase, "LOGIN", "user", user.id, { mfa: true });
  redirect(safeNext(next));
}

/** Asks for the password again before a sensitive step. A fresh sign-in resets the "recently signed in" clock. */
export async function reauthAction(
  next: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  if (!password) return { fieldErrors: { password: ["Enter your password."] } };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");
  const ip = await clientIp();
  const [byUser, byIp] = await Promise.all([
    rateLimit(`reauth-user:${user.id}`, 6, 10 * 60_000),
    rateLimit(`login-ip:${ip}`, 20, 10 * 60_000),
  ]);
  if (!byUser.allowed || !byIp.allowed) {
    await logSecurityEvent("LOGIN_THROTTLED", user.email, ip, "re-confirmation");
    return TOO_MANY;
  }
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
  if (error) {
    await logSecurityEvent("LOGIN_FAILED", user.email, ip, "re-confirmation");
    return { message: "That password isn't right." };
  }
  await supabase.rpc("log_my_security_event", { p_kind: "REAUTH_OK", p_ip: ip });
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2")
    redirect(`/login/mfa?next=${encodeURIComponent(safeNext(next))}`);
  redirect(safeNext(next));
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  if (!isSupabaseConfigured()) {
    logger.error("supabase not configured", { missing: missingSupabaseVars() });
    return NOT_CONFIGURED;
  }

  const ip = await clientIp();
  if (!(await rateLimit(`register-ip:${ip}`, 10, 60 * 60_000)).allowed) return TOO_MANY;

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
  if (!isSupabaseConfigured()) {
    logger.error("supabase not configured", { missing: missingSupabaseVars() });
    return NOT_CONFIGURED;
  }

  const ip = await clientIp();
  const [byIp, byEmail] = await Promise.all([
    rateLimit(`reset-ip:${ip}`, 10, 60 * 60_000),
    rateLimit(`reset-email:${parsed.data.email.toLowerCase()}`, 3, 60 * 60_000),
  ]);
  // Same response either way, so throttling can't be used to probe which emails exist.
  if (!byIp.allowed || !byEmail.allowed)
    return {
      ok: true,
      message: "If an account exists for that email, a reset link is on its way.",
    };

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
  if (!isSupabaseConfigured()) {
    logger.error("supabase not configured", { missing: missingSupabaseVars() });
    return NOT_CONFIGURED;
  }

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
    // Load the session first: without it the database call runs as the anonymous role and is refused.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await audit(supabase, "LOGOUT", "user", user.id);
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
  if (session.needsMfa) redirect("/login/mfa");
  if (session.organization) redirect("/dashboard");

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", { org_name: parsed.data.name });
  if (error) {
    logger.error("create_organization failed", { error: error.message });
    return GENERIC;
  }
  redirect("/dashboard");
}

/** Joins the organization that invited the signed-in user's verified email address. */
export async function acceptInviteAction(): Promise<FormState> {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (session.needsMfa) redirect("/login/mfa");
  if (session.organization) redirect("/dashboard");
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invite");
  if (error) {
    logger.warn("accept invite failed", { code: error.code });
    if (error.code === "P0020")
      return { message: "That organization has no free seats. Ask them to upgrade their plan." };
    return { message: "This invitation is no longer valid." };
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
