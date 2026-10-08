"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removeRequirementAction, setCountryActiveAction } from "@/app/(app)/visa/actions";

type Result = { ok?: boolean; message?: string };
const report = (r: Result) => {
  if (r.message) (r.ok ? toast.success : toast.error)(r.message);
};

export function RemoveRequirementButton({ productId, id }: { productId: string; id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() => start(async () => report(await removeRequirementAction(productId, id)))}
    >
      Remove
    </Button>
  );
}

export function CountryToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={pending}
      onClick={() => start(async () => report(await setCountryActiveAction(id, !active)))}
    >
      {active ? "Disable" : "Enable"}
    </Button>
  );
}
