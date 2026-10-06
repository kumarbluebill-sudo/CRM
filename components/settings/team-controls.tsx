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
import {
  changeRoleAction,
  removeMemberAction,
  revokeInviteAction,
} from "@/app/(app)/settings/team/actions";

const selectClass =
  "border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-8 rounded-lg border px-2 text-sm outline-none focus-visible:ring-3";

export function RoleSelect({
  userId,
  current,
  options,
}: {
  userId: string;
  current: string;
  options: { value: string; label: string }[];
}) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(current);
  return (
    <select
      aria-label="Role"
      className={selectClass}
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        const prev = value;
        setValue(next);
        start(async () => {
          const r = await changeRoleAction(userId, next);
          if (!r.ok) {
            setValue(prev);
            toast.error(r.message ?? "Couldn't change the role.");
          } else toast.success(r.message ?? "Role updated.");
        });
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function RemoveMemberButton({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="ghost" />}>Remove</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {name}?</DialogTitle>
          <DialogDescription>
            They lose access immediately. Their work (leads, bookings, notes) stays in your
            organization.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await removeMemberAction(userId);
                if (r.message) (r.ok ? toast.success : toast.error)(r.message);
                if (r.ok) setOpen(false);
              })
            }
          >
            {pending ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RevokeInviteButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await revokeInviteAction(id);
          if (r.message) (r.ok ? toast.success : toast.error)(r.message);
        })
      }
    >
      Revoke
    </Button>
  );
}
