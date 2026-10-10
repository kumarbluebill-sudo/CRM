import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { loginAction } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string }>;
}) {
  const { error, reason } = await searchParams;
  return (
    <>
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        Welcome back to your agency workspace.
      </p>
      {reason === "timeout" && (
        <p role="status" className="text-muted-foreground mb-4 text-sm">
          You were signed out after a period of inactivity. Please sign in again.
        </p>
      )}
      {error === "link" && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          That link is invalid or has expired. Please try again.
        </p>
      )}
      <AuthForm
        action={loginAction}
        submitLabel="Sign in"
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "current-password",
          },
        ]}
      />
      <div className="text-muted-foreground mt-4 flex justify-between text-sm">
        <Link href="/forgot-password" className="hover:text-foreground underline">
          Forgot password?
        </Link>
        <Link href="/register" className="hover:text-foreground underline">
          Create account
        </Link>
      </div>
    </>
  );
}
