"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { groupPermissions, summarisePermissions } from "@/lib/permissions/groups";
import {
  assignRoleAction,
  deleteRoleAction,
  saveRoleAction,
  setAssignmentLimitAction,
  setBranchAction,
} from "@/app/(app)/settings/roles/actions";

const selectClass =
  "border-input bg-card focus-visible:ring-ring/20 focus-visible:border-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3";

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  base_role: string;
  data_scope: string;
  permissions: string[];
  members: number;
};

const SCOPES = [
  { value: "all", label: "Everything in the agency" },
  { value: "branch", label: "Own branch only" },
  { value: "assigned", label: "Records assigned to them" },
  { value: "own", label: "Only records they created" },
];

/** Create or edit a role: base role, data scope and a permission matrix limited to what the editor holds. */
export function RoleEditor({
  role,
  bases,
  grantable,
}: {
  role?: RoleRow;
  bases: { value: string; label: string }[];
  grantable: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [baseRole, setBaseRole] = useState(role?.base_role ?? bases[0]?.value ?? "");
  const [dataScope, setDataScope] = useState(role?.data_scope ?? "all");
  const [picked, setPicked] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const groups = useMemo(() => groupPermissions(grantable), [grantable]);
  const summary = summarisePermissions([...picked]);

  const toggle = (key: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveRoleAction(role?.id ?? null, {
            name,
            description: description || undefined,
            baseRole,
            dataScope,
            permissions: [...picked],
          });
          if (r.message) (r.ok ? toast.success : toast.error)(r.message);
          if (r.ok) {
            if (!role) {
              setName("");
              setDescription("");
              setPicked(new Set());
            }
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Role name
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Treated like (sets who can manage them)
          <select
            className={selectClass}
            value={baseRole}
            onChange={(e) => setBaseRole(e.target.value)}
          >
            {bases.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
          Description (optional)
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
          Which records can they see?
          <select
            className={selectClass}
            value={dataScope}
            onChange={(e) => setDataScope(e.target.value)}
          >
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">What can they do?</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <div key={g.key} className="rounded-lg border p-2.5">
              <p className="mb-1.5 text-xs font-semibold">{g.label}</p>
              <ul className="flex flex-col gap-1">
                {g.items.map((i) => (
                  <li key={i.key}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        aria-label={`${g.label}: ${i.label}`}
                        checked={picked.has(i.key)}
                        onChange={() => toggle(i.key)}
                        className="size-4"
                      />
                      {i.label}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          You can only offer permissions you hold yourself. Staff on this role can do nothing that
          is not ticked here.
        </p>
      </fieldset>

      <div className="bg-muted rounded-lg p-3 text-sm" aria-live="polite">
        <p className="mb-1 font-medium">Summary</p>
        {summary.length === 0 ? (
          <p className="text-muted-foreground">
            No permissions selected: people on this role can sign in but see nothing.
          </p>
        ) : (
          <ul className="text-muted-foreground list-disc pl-5">
            {summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground mt-1">
          Records: {SCOPES.find((s) => s.value === dataScope)?.label.toLowerCase()}.
        </p>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {role ? "Save role" : "Create role"}
        </Button>
        {role && (
          <Button
            type="button"
            variant="destructive"
            disabled={pending || role.members > 0}
            title={role.members > 0 ? "Move the people on this role elsewhere first" : undefined}
            onClick={() => {
              if (!confirm(`Delete the role "${role.name}"?`)) return;
              start(async () => {
                const r = await deleteRoleAction(role.id);
                if (r.message) (r.ok ? toast.success : toast.error)(r.message);
                router.refresh();
              });
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

export type StaffRow = {
  userId: string;
  name: string;
  email: string;
  systemRole: string;
  orgRoleId: string | null;
  branchId: string | null;
  maxJobs: number | null;
  canManage: boolean;
  isSelf: boolean;
};

/** Searchable staff list with custom role, branch and open-job limit per person. */
export function StaffAccessTable({
  staff,
  roles,
  branches,
}: {
  staff: StaffRow[];
  roles: { id: string; name: string }[];
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const shown = staff.filter((s) =>
    `${s.name} ${s.email}`.toLowerCase().includes(q.trim().toLowerCase()),
  );

  const run = (fn: () => Promise<{ ok?: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.message) (r.ok ? toast.success : toast.error)(r.message);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="relative max-w-xs">
        <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" aria-hidden />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search staff"
          aria-label="Search staff"
          className="pl-8"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="px-3 py-2.5">Person</th>
              <th className="px-3 py-2.5">Role</th>
              <th className="px-3 py-2.5">Branch</th>
              <th className="px-3 py-2.5">Open job limit</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.userId}>
                <td className="px-3 py-2.5">
                  <p className="font-medium">{s.name || s.email}</p>
                  <p className="text-muted-foreground text-xs">
                    {s.email} · {s.systemRole.replace("_", " ").toLowerCase()}
                  </p>
                </td>
                <td className="px-3 py-2.5">
                  <select
                    aria-label={`Role for ${s.name || s.email}`}
                    className={selectClass}
                    disabled={pending || !s.canManage || s.isSelf}
                    value={s.orgRoleId ?? ""}
                    onChange={(e) => run(() => assignRoleAction(s.userId, e.target.value || null))}
                  >
                    <option value="">Standard role</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2.5">
                  <select
                    aria-label={`Branch for ${s.name || s.email}`}
                    className={selectClass}
                    disabled={pending}
                    value={s.branchId ?? ""}
                    onChange={(e) => run(() => setBranchAction(s.userId, e.target.value || null))}
                  >
                    <option value="">No branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2.5">
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    defaultValue={s.maxJobs ?? ""}
                    placeholder="No limit"
                    aria-label={`Open job limit for ${s.name || s.email}`}
                    className="w-28"
                    disabled={pending}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v === s.maxJobs) return;
                      run(() => setAssignmentLimitAction(s.userId, v));
                    }}
                  />
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="text-muted-foreground px-3 py-6 text-center">
                  No staff match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
