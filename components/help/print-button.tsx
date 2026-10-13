"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog, which also offers "Save as PDF". */
export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden /> {label}
    </Button>
  );
}
