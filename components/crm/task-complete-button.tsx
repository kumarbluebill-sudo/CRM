"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setTaskStatusAction } from "@/app/(app)/tasks/actions";

export function TaskCompleteButton({ id, done }: { id: string; done: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setTaskStatusAction(id, done ? "TODO" : "COMPLETED");
          if (res.message) toast.error(res.message);
        })
      }
    >
      <Check className="size-4" aria-hidden />
      {done ? "Reopen" : "Complete"}
    </Button>
  );
}
