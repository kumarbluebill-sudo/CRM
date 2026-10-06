import { Download, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { label } from "@/lib/crm/constants";
import type { DocumentRow } from "@/lib/booking/queries";

export function DocumentList({ docs, canDownload }: { docs: DocumentRow[]; canDownload: boolean }) {
  if (docs.length === 0) return <p className="text-muted-foreground text-sm">No documents yet.</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 font-medium">
              {d.is_sensitive && <Lock className="size-3.5 shrink-0" aria-label="Restricted" />}
              <span className="truncate">{d.name}</span>
            </span>
            <span className="text-muted-foreground block text-xs">
              {label(d.category)} · {(d.size_bytes / 1024).toFixed(0)} KB ·{" "}
              {new Date(d.created_at).toLocaleDateString("en-IN")}
            </span>
          </span>
          {canDownload && (
            <Button
              size="xs"
              variant="outline"
              nativeButton={false}
              render={<a href={`/api/documents/${d.id}/download`} rel="noopener" />}
            >
              <Download className="size-3.5" aria-hidden /> Download
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
