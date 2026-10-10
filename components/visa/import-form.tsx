"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  commitImportAction,
  previewImportAction,
  type ImportPreview,
} from "@/app/(app)/visa/actions";
import { MAX_IMPORT_BYTES } from "@/lib/visa/csv-parse";

const tone: Record<string, string> = {
  VALID: "text-tone-ok",
  IMPORTED: "text-tone-ok",
  DUPLICATE: "text-tone-warn",
  INVALID: "text-tone-bad",
};

export function ImportForm({
  kind,
  columns,
}: {
  kind: "countries" | "products";
  columns: string[];
}) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPreview(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error("That file is too large (300 KB maximum).");
      return;
    }
    setCsv(await file.text());
  }

  const check = () =>
    start(async () => {
      const r = await previewImportAction(kind, csv);
      setPreview(r);
      if (r.message && !r.ok) toast.error(r.message);
    });
  const confirm = () =>
    start(async () => {
      const r = await commitImportAction(kind, csv);
      setPreview(r);
      if (r.message) (r.ok ? toast.success : toast.error)(r.message);
      if (r.ok) {
        setCsv("");
        router.refresh();
      }
    });

  const valid = preview?.summary?.VALID ?? 0;
  const imported = preview?.summary?.IMPORTED ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        Columns: <code>{columns.join(", ")}</code>. First row must be the header.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label={`CSV file of ${kind}`}
        onChange={onFile}
        className="text-sm"
      />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!csv || pending} onClick={check}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Check the file
        </Button>
        <Button
          size="sm"
          disabled={!csv || pending || valid === 0 || imported > 0}
          onClick={confirm}
        >
          Import {valid} valid row{valid === 1 ? "" : "s"}
        </Button>
      </div>
      {preview?.message && !preview.rows && (
        <p role="alert" className="text-destructive text-sm">
          {preview.message}
        </p>
      )}
      {preview?.rows && (
        <div className="flex flex-col gap-2">
          <p className="text-sm" role="status">
            {Object.entries(preview.summary ?? {})
              .map(([k, n]) => `${n} ${k.toLowerCase()}`)
              .join(" · ")}
          </p>
          <ul className="max-h-72 divide-y overflow-auto rounded-lg border text-sm">
            {preview.rows.map((r) => (
              <li key={r.row} className="flex gap-3 px-3 py-1.5">
                <span className="text-muted-foreground w-12 shrink-0">Row {r.row}</span>
                <span className={`w-24 shrink-0 font-medium ${tone[r.status] ?? ""}`}>
                  {r.status}
                </span>
                <span className="text-muted-foreground">{r.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
