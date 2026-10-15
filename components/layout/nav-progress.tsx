"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * A thin progress bar at the top of the shell. It starts when an in-app link is clicked and finishes when the path
 * changes, so slow server pages no longer feel frozen. It also returns the scrolling area to the top on each new page.
 */
export function NavProgress() {
  const pathname = usePathname();
  // the path the person left; the bar shows until the current path differs from it
  const [from, setFrom] = useState<string | null>(null);
  const active = from !== null && from === pathname;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      setFrom(window.location.pathname);
      // never leave the bar stuck if the navigation is cancelled
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFrom(null), 15000);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    document.getElementById("main")?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div
      aria-hidden
      data-testid="nav-progress"
      data-active={active}
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden print:hidden"
    >
      {active && <div className="bg-primary h-full w-1/3 animate-[nav-progress_1.1s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />}
    </div>
  );
}
