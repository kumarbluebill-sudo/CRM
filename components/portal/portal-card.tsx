import { StatusBadge } from "@/components/crm/status-badge";
import {
  CreateLinkForm,
  RevokeLinkButton,
  ShareDocumentToggle,
} from "@/components/portal/portal-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { linkState } from "@/lib/portal/state";
import { createClient } from "@/lib/supabase/server";

/** Staff-side controls for one booking's customer portal: links and which documents the customer can see. */
export async function PortalCard({ bookingId, active }: { bookingId: string; active: boolean }) {
  const supabase = await createClient();
  const [links, docs] = await Promise.all([
    supabase
      .from("portal_links")
      .select("id, expires_at, revoked_at, created_at, last_used_at, use_count")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("documents")
      .select("id, name, category, portal_visible")
      .eq("booking_id", bookingId)
      .eq("is_sensitive", false)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Customer portal</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {active ? (
          <CreateLinkForm bookingId={bookingId} />
        ) : (
          <p className="text-muted-foreground text-sm">Links can be created for active bookings.</p>
        )}
        {(links.data ?? []).length > 0 && (
          <ul className="divide-y rounded-lg border text-sm">
            {(links.data ?? []).map((l) => {
              const s = linkState(l);
              return (
                <li key={l.id as string} className="flex flex-wrap items-center gap-3 p-2.5">
                  <span>Created {String(l.created_at).slice(0, 10)}</span>
                  <span className="text-muted-foreground">
                    expires {String(l.expires_at).slice(0, 10)} · opened {l.use_count as number}×
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <StatusBadge value={s === "ACTIVE" ? "ISSUED" : "VOID"} />
                    <span className="text-xs">{s.charAt(0) + s.slice(1).toLowerCase()}</span>
                    {s === "ACTIVE" && (
                      <RevokeLinkButton bookingId={bookingId} id={l.id as string} />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <section aria-label="Shared documents" className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Documents the customer can download</h3>
          {(docs.data ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Upload tickets or vouchers to this booking, then share them here. Passport and visa
              files can never be shared.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {(docs.data ?? []).map((d) => (
                <li key={d.id as string} className="flex items-center gap-3 p-2.5">
                  <span className="min-w-0 flex-1 truncate">{d.name as string}</span>
                  <ShareDocumentToggle
                    bookingId={bookingId}
                    id={d.id as string}
                    shared={d.portal_visible as boolean}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
