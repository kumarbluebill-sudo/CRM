import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { resetPasswordAction } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Set new password" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Set a new password</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        At least 10 characters with upper, lower case and a number.
      </p>
      <AuthForm
        action={resetPasswordAction}
        submitLabel="Update password"
        fields={[
          {
            name: "password",
            label: "New password",
            type: "password",
            autoComplete: "new-password",
          },
          {
            name: "confirm",
            label: "Confirm password",
            type: "password",
            autoComplete: "new-password",
          },
        ]}
      />
    </>
  );
}
