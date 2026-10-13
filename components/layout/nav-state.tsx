"use client";

import { createContext, useContext, useMemo } from "react";
import type { NavBadge } from "@/components/layout/nav-config";

/** What the sidebar needs from the signed-in session: which permissions to filter by, and the badge counts. */
type NavState = { permissions: string[]; badges: Partial<Record<NavBadge, number>> };

const NavStateContext = createContext<NavState>({ permissions: [], badges: {} });

export function NavStateProvider({
  permissions,
  badges,
  children,
}: NavState & { children: React.ReactNode }) {
  const value = useMemo(() => ({ permissions, badges }), [permissions, badges]);
  return <NavStateContext.Provider value={value}>{children}</NavStateContext.Provider>;
}

export const useNavState = () => useContext(NavStateContext);
