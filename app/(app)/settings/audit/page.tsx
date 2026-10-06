import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { PAGE_SIZE, label } from "@/lib/crm/constants";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit log" };

const ACTIONS = [
  "LOGIN",
  "LOGOUT",
  "CREATE",
  "UPDATE",
  "DELETE",
  "DOWNLOAD",
  "UPLOAD",
  "EXPORT",
  "PAYMENT",
  "PERMISSION_CHANGE",
  "SETTINGS_CHANGE",
  "STATUS_CHANGE",
  "CONVERT",
] as const;

/** Compact, safe rendering of the metadata object (the database already strips secret-looking keys). */
const summarize = (m: unknown) =>
  Object.entries((m ?? {}) as Record<string, unknown>)
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`.slice(0, 80))
    .join(" · ");

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string; page?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("settings.manage")) {
    return (
      <EmptyState
        icon={ScrollText}
        title="No access"
        description="Only owners and admins can view the audit log."
      />
    );
  }
  const sp = await searchParams;
  const action = ACTIONS.find((a) => a === sp.action);
  const entity = /^[a-z_]{1,60}$/.test(sp.entity ?? "") ? sp.entity : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const supabase = await createClient();
  let q = supabase
    .from("audit_logs")
    .select("id, user_id, action, entity_type, entity_id, metadata, ip_address, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (action) q = q.eq("action", action);
  if (entity) q = q.eq("entity_type", entity);
  const { data, count, error } = await q;
  if (error) throw error;

  const ids = [
    ...new Set((data ?? []).map((r) => r.user_id as string | null).filter(Boolean)),
  ] as string[];
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] };
  const names = new Map(
    (people ?? []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string)]),
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Audit log"
        description="A permanent, read-only record of sensitive actions in your organization."
      />
      <nav aria-label="Filter by action" className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/settings/audit"
          className={!action ? "font-semibold underline" : "hover:underline"}
        >
          All
        </Link>
        {ACTIONS.map((a) => (
          <Link
            key={a}
            href={`/settings/audit?action=${a}`}
            className={action === a ? "font-semibold underline" : "hover:underline"}
          >
            {label(a)}
          </Link>
        ))}
      </nav>
      <Card>
        <CardContent>
          {(data ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing recorded for this filter.</p>
          ) : (
            <ul className="divide-y text-sm">
              {(data ?? []).map((r) => (
                <li key={r.id as string} className="flex flex-col gap-1 py-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">{label(r.action as string)}</span>
                    <span>{label(r.entity_type as string)}</span>
                    <span className="text-muted-foreground">
                      {r.user_id
                        ? (names.get(r.user_id as string) ?? "Former member")
                        : "System / customer"}
                    </span>
                    <span className="text-muted-foreground ml-auto">
                      {String(r.created_at).slice(0, 19).replace("T", " ")} UTC
                    </span>
                  </div>
                  {summarize(r.metadata) && (
                    <p className="text-muted-foreground text-xs">{summarize(r.metadata)}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pagination
        page={page}
        total={count ?? 0}
        basePath="/settings/audit"
        params={{ action, entity }}
      />
      <div>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/settings" />}>
          Back to settings
        </Button>
      </div>
    </div>
  );
}
