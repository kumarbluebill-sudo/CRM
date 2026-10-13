"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav } from "@/components/layout/sidebar-nav";

/**
 * Slide-out menu for screens narrower than the desktop breakpoint. It is the same menu as the sidebar, always
 * expanded, with a backdrop, a close button, Escape to close, and the profile footer pinned at the bottom.
 */
export function MobileNav({
  name,
  brand,
  footer,
}: {
  name: string;
  brand: React.ReactNode;
  footer: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" />
        }
      >
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="bg-sidebar text-sidebar-foreground border-sidebar-border w-72 max-w-[85vw] gap-0 p-0"
      >
        <div data-collapsed="false" className="group flex h-full min-h-0 flex-col">
          <SheetHeader className="border-sidebar-border h-14 shrink-0 justify-center border-b py-0 pr-14 pl-3">
            <SheetTitle className="sr-only">{name}</SheetTitle>
            <div className="min-w-0">{brand}</div>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
          {footer}
        </div>
      </SheetContent>
    </Sheet>
  );
}
