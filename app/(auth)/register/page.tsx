import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { registerAction } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        You&apos;ll set up your agency after verifying your email.
      </p>
      <AuthForm
        action={registerAction}
        submitLabel="Create account"
        fields={[
          { name: "fullName", label: "Full name", autoComplete: "name" },
          { name: "email", label: "Work email", type: "email", autoComplete: "email" },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "new-password",
          },
        ]}
      />
      <p className="text-muted-foreground mt-4 text-sm">
        Already registered?{" "}
        <Link href="/login" className="hover:text-foreground underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
