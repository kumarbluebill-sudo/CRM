"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** Submit button for server-action forms: disables itself and shows a spinner while the form is saving, so it cannot be double-submitted. */
export function SubmitButton({ children, ...props }: Omit<React.ComponentProps<typeof Button>, "type" | "loading">) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {children}
    </Button>
  );
}
