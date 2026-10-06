import Link from "next/link";
import { StatusBadge } from "@/components/crm/status-badge";
import { DiscardButton, SendQueuedButton } from "@/components/comms/outbox-controls";
import { Card, CardContent } from "@/components/ui/card";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_LABELS,
  renderTemplate,
  type TemplateKey,
} from "@/lib/comms/templates";
import type { CommRow } from "@/lib/comms/queries";

/** Message log. Drafts show the rendered text so a person reads it before pressing send. */
export function CommsList({
  rows,
  templates,
  orgName,
  canSend,
}: {
  rows: (CommRow & { vars?: Record<string, unknown> })[];
  templates: { template_key: string; channel: string; body: string }[];
  orgName: string;
  canSend: boolean;
}) {
  if (rows.length === 0)
    return (
      <Card>
        <CardContent>
          <p className="text-muted-foreground text-sm">No messages yet.</p>
        </CardContent>
      </Card>
    );
  const preview = (r: CommRow & { vars?: Record<string, unknown> }) => {
    if (r.body) return r.body;
    const own = templates.find((t) => t.template_key === r.template_key && t.channel === r.channel);
    const body = own?.body ?? DEFAULT_TEMPLATES[r.template_key as TemplateKey]?.body ?? "";
    return renderTemplate(body, { org_name: orgName, ...(r.vars ?? {}) });
  };
  return (
    <Card>
      <CardContent>
        <ul className="divide-y text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1.5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{r.customers?.name ?? "Customer"}</span>
                <span className="text-muted-foreground">
                  {r.channel === "EMAIL" ? "Email" : "WhatsApp"} ·{" "}
                  {TEMPLATE_LABELS[r.template_key as TemplateKey] ?? r.template_key}
                </span>
                {r.bookings && r.booking_id && (
                  <Link href={`/bookings/${r.booking_id}`} className="hover:underline">
                    {r.bookings.booking_number}
                  </Link>
                )}
                <span className="text-muted-foreground">
                  {r.created_at.slice(0, 16).replace("T", " ")}
                </span>
                {r.source === "AUTOMATION" && (
                  <span className="text-muted-foreground text-xs">auto-drafted</span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <StatusBadge value={r.status} />
                  {canSend && (r.status === "QUEUED" || r.status === "FAILED") && (
                    <>
                      <SendQueuedButton id={r.id} retry={r.status === "FAILED"} />
                      <DiscardButton id={r.id} />
                    </>
                  )}
                </span>
              </div>
              <p className="text-muted-foreground line-clamp-3 text-xs whitespace-pre-line">
                {r.subject ? `${r.subject}\n` : ""}
                {preview(r)}
              </p>
              {r.error && <p className="text-destructive text-xs">{r.error}</p>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
