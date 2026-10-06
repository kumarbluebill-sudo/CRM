"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveRuleAction } from "@/app/(app)/communications/actions";

export function RuleRow({
  trigger,
  channel,
  title,
  help,
  enabled: initialEnabled,
  days: initialDays,
}: {
  trigger: string;
  channel: string;
  title: string;
  help: string;
  enabled: boolean;
  days: number;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [days, setDays] = useState(String(initialDays));
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3 py-3 text-sm">
      <label className="flex min-w-56 items-center gap-2 font-medium">
        <input
          type="checkbox"
          className="size-4 rounded border"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {title}
      </label>
      <label className="text-muted-foreground flex items-center gap-2">
        {help}
        <Input
          type="number"
          min={0}
          max={60}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="w-20"
          aria-label={`${title}: days`}
        />
      </label>
      <Button
        size="xs"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await saveRuleAction(trigger, channel, enabled, Number(days));
            if (r.message) (r.ok ? toast.success : toast.error)(r.message);
          })
        }
      >
        Save
      </Button>
    </div>
  );
}
