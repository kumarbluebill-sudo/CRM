import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { forgotPasswordAction } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        Enter your email and we&apos;ll send a reset link.
      </p>
      <AuthForm
        action={forgotPasswordAction}
        submitLabel="Send reset link"
        fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
      />
      <p className="mt-4 text-sm">
        <Link href="/login" className="text-muted-foreground hover:text-foreground underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
