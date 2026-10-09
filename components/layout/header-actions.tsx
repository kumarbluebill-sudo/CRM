"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type QuickAction = { label: string; href: string };

/** Global search: Enter opens the results page, which queries only what the signed-in user may read. */
export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      aria-label="Search the CRM"
      className="relative hidden w-full max-w-sm md:block"
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        if (v.length >= 2) router.push(`/search?q=${encodeURIComponent(v)}`);
      }}
    >
      <Search
        className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4"
        aria-hidden
      />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={60}
        placeholder="Search customers, bookings, visas…"
        aria-label="Search"
        className="border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-8 w-full rounded-lg border pr-2.5 pl-8 text-sm outline-none focus-visible:ring-3"
      />
    </form>
  );
}

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" aria-label="Quick actions" />}>
        <Plus className="size-4" aria-hidden />
        <span className="hidden sm:inline">New</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {actions.map((a) => (
          <DropdownMenuItem key={a.href} render={<Link href={a.href} />}>
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
