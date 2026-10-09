"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TemplateThumb } from "@/components/packages/template-thumb";
import { TEMPLATES } from "@/lib/packages/templates";
import { selectTemplateAction } from "@/app/(app)/itineraries/[id]/package/actions";

export function TemplateGallery({
  id,
  current,
  canEdit,
}: {
  id: string;
  current: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <ul
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      aria-label="Package templates"
    >
      {TEMPLATES.map((t) => {
        const selected = t.key === current;
        return (
          <li
            key={t.key}
            className={`bg-card flex flex-col overflow-hidden rounded-xl border ${selected ? "ring-primary ring-2" : ""}`}
          >
            <TemplateThumb t={t} className="bg-muted w-full" />
            <div className="flex flex-1 flex-col gap-1.5 p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                {t.name}
                {selected && <Check className="text-primary size-4" aria-label="Selected" />}
              </h3>
              <p className="text-muted-foreground flex-1 text-xs">{t.description}</p>
              <div className="flex items-center gap-1.5" aria-hidden>
                {[t.theme.primary, t.theme.secondary, t.theme.accent].map((c) => (
                  <span
                    key={c}
                    className="size-3.5 rounded-full border"
                    style={{ background: c }}
                  />
                ))}
                <span className="text-muted-foreground ml-1 text-[11px]">
                  {t.theme.layout.toLowerCase()} · {t.theme.font === "SERIF" ? "serif" : "sans"}
                </span>
              </div>
              {canEdit && (
                <Button
                  size="sm"
                  variant={selected ? "secondary" : "default"}
                  disabled={pending || selected}
                  aria-label={selected ? `${t.name} is selected` : `Select template ${t.name}`}
                  onClick={() => {
                    setBusy(t.key);
                    start(async () => {
                      const r = await selectTemplateAction(id, t.key);
                      if (r.message) (r.ok ? toast.success : toast.error)(r.message);
                      setBusy(null);
                      router.refresh();
                    });
                  }}
                >
                  {busy === t.key && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {selected ? "Selected" : "Select template"}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
