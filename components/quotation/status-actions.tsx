"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ConfirmActionButton } from "@/components/crm/confirm-action-button";
import { deleteQuotationAction, setQuotationStatusAction } from "@/app/(app)/quotations/actions";

type Action = {
  to: string;
  label: string;
  description: string;
  primary?: boolean;
  needs: "quotes.send" | "quotes.update";
};

const FLOW: Record<string, Action[]> = {
  DRAFT: [
    {
      to: "SENT",
      label: "Mark as sent",
      description:
        "This locks the quotation for editing and saves a snapshot of what the customer sees.",
      primary: true,
      needs: "quotes.send",
    },
  ],
  SENT: [
    {
      to: "NEGOTIATION",
      label: "Negotiate",
      description: "Re-opens the quotation for editing.",
      needs: "quotes.update",
    },
    {
      to: "APPROVED",
      label: "Approve",
      description: "Records that the customer accepted the selected option.",
      primary: true,
      needs: "quotes.update",
    },
    {
      to: "REJECTED",
      label: "Reject",
      description: "Records that the customer declined.",
      needs: "quotes.update",
    },
    {
      to: "EXPIRED",
      label: "Expire",
      description: "Marks the quotation as no longer valid.",
      needs: "quotes.update",
    },
  ],
  VIEWED: [
    {
      to: "NEGOTIATION",
      label: "Negotiate",
      description: "Re-opens the quotation for editing.",
      needs: "quotes.update",
    },
    {
      to: "APPROVED",
      label: "Approve",
      description: "Records that the customer accepted the selected option.",
      primary: true,
      needs: "quotes.update",
    },
    {
      to: "REJECTED",
      label: "Reject",
      description: "Records that the customer declined.",
      needs: "quotes.update",
    },
    {
      to: "EXPIRED",
      label: "Expire",
      description: "Marks the quotation as no longer valid.",
      needs: "quotes.update",
    },
  ],
  NEGOTIATION: [
    {
      to: "SENT",
      label: "Send revised quote",
      description: "Locks the revised quotation and saves a new snapshot.",
      primary: true,
      needs: "quotes.send",
    },
    {
      to: "APPROVED",
      label: "Approve",
      description: "Records that the customer accepted the selected option.",
      needs: "quotes.update",
    },
    {
      to: "REJECTED",
      label: "Reject",
      description: "Records that the customer declined.",
      needs: "quotes.update",
    },
    {
      to: "EXPIRED",
      label: "Expire",
      description: "Marks the quotation as no longer valid.",
      needs: "quotes.update",
    },
  ],
  REJECTED: [
    {
      to: "NEGOTIATION",
      label: "Re-open",
      description: "Moves back to negotiation so it can be edited.",
      needs: "quotes.update",
    },
  ],
  EXPIRED: [
    {
      to: "DRAFT",
      label: "Back to draft",
      description: "Makes the quotation editable again.",
      needs: "quotes.update",
    },
  ],
};

export function QuotationStatusActions({
  id,
  status,
  permissions,
  canDelete,
}: {
  id: string;
  status: string;
  permissions: string[];
  canDelete: boolean;
}) {
  const actions = (FLOW[status] ?? []).filter((a) => permissions.includes(a.needs));
  const deletable = canDelete && ["DRAFT", "EXPIRED", "REJECTED"].includes(status);
  return (
    <>
      {actions.map((a) => (
        <StatusButton key={a.to} id={id} action={a} />
      ))}
      {deletable && (
        <ConfirmActionButton
          action={deleteQuotationAction.bind(null, id)}
          triggerLabel="Delete"
          title="Delete this quotation?"
          description="This permanently removes the quotation, its options and its history."
        />
      )}
    </>
  );
}

function StatusButton({ id, action }: { id: string; action: Action }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant={action.primary ? "default" : "outline"} />}>
        {action.label}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action.label}?</DialogTitle>
          <DialogDescription>{action.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await setQuotationStatusAction(id, action.to);
                if (res.ok) toast.success(res.message ?? "Updated");
                else toast.error(res.message ?? "Could not update.");
                setOpen(false);
              })
            }
          >
            {pending ? "Working…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
