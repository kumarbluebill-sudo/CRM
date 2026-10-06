"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,.xlsx,.txt";

export function ImportUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const file = input.current?.files?.[0];
    if (!file) return setError("Choose a file to upload.");
    if (file.size > MAX_BYTES) return setError("The file is larger than 4 MB.");

    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/itineraries/import", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        setError(json.error ?? "Upload failed. Please try again.");
        return;
      }
      router.push(`/itineraries/import/${json.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="hover:bg-muted/50 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center">
        <Upload className="text-muted-foreground size-6" aria-hidden />
        <span className="text-sm font-medium">Choose a PDF, DOCX, XLSX or TXT file</span>
        <span className="text-muted-foreground text-xs">
          Up to 4 MB. Scanned documents/images aren&apos;t supported yet.
        </span>
        <input ref={input} type="file" accept={ACCEPT} className="mt-2 text-sm" disabled={busy} />
      </label>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {busy ? "Reading document…" : "Upload and analyse"}
        </Button>
      </div>
    </form>
  );
}
