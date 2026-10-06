"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { moveLeadStatusAction } from "@/app/(app)/leads/actions";
import { LEAD_STATUSES, label } from "@/lib/crm/constants";

/** Moves a lead between pipeline stages. The server re-checks permission and ownership. */
export function LeadStatusSelect({
  leadId,
  status,
  disabled,
}: {
  leadId: string;
  status: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Move to stage"
      value={status}
      disabled={disabled || pending}
      onChange={(e) =>
        start(async () => {
          const res = await moveLeadStatusAction(leadId, e.target.value);
          if (res.message) toast.error(res.message);
          else toast.success("Stage updated");
        })
      }
      className="border-input bg-background h-7 w-full rounded-md border px-1.5 text-xs disabled:opacity-60"
    >
      {LEAD_STATUSES.map((s) => (
        <option key={s} value={s}>
          {label(s)}
        </option>
      ))}
    </select>
  );
}
