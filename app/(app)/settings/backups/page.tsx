import type { Metadata } from "next";
import { DatabaseBackup } from "lucide-react";
import {
  ClosePlanButtons,
  RestorePlanButton,
  RunBackupButton,
  VerifyBackupButton,
} from "@/components/backups/backup-controls";
import { LocalTime } from "@/components/datetime/local-time";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getBackupConfig } from "@/lib/backup/run";
import { requireOrgSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { saveBackupSettingsAction } from "@/app/(app)/settings/backups/actions";

export const metadata: Metadata = { title: "Backups" };

type Run = {
  id: string;
  kind: string;
  status: string;
  started_at: string;
  size_bytes: number | null;
  row_counts: Record<string, number> | null;
  verify_ok: boolean | null;
  verified_at: string | null;
  error: string | null;
  deleted_at: string | null;
};

const KIND: Record<string, string> = {
  SCHEDULED: "Scheduled",
  MANUAL: "Manual",
  PRE_RESTORE: "Safety copy before a restore",
};
const sum = (c: Record<string, number> | null) => Object.values(c ?? {}).reduce((a, b) => a + b, 0);
const size = (n: number | null) =>
  n == null
    ? "–"
    : n < 1048576
      ? `${Math.max(1, Math.round(n / 1024))} KB`
      : `${(n / 1048576).toFixed(1)} MB`;

export default async function BackupsPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("backup.manage")) {
    return (
      <EmptyState
        icon={DatabaseBackup}
        title="No access"
        description="Only people who are allowed to manage backups can open this page."
      />
    );
  }
  const supabase = await createClient();
  const [{ data: settings }, { data: runs }, { data: restores }] = await Promise.all([
    supabase.from("backup_settings").select("*").maybeSingle(),
    supabase
      .from("backup_runs")
      .select(
        "id, kind, status, started_at, size_bytes, row_counts, verify_ok, verified_at, error, deleted_at",
      )
      .order("started_at", { ascending: false })
      .limit(30),
    supabase
      .from("backup_restores")
      .select("id, backup_run_id, status, plan, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const cfg = getBackupConfig();
  const configured = !("missing" in cfg);
  const list = (runs ?? []) as Run[];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Backups"
        description="Encrypted copies of your agency's records, kept outside the application. Files in document storage are not part of these copies."
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Backups" }]}
        actions={<RunBackupButton disabled={!configured} />}
      />
      {"missing" in cfg && (
        <p
          role="note"
          className="border-tone-warn/30 bg-tone-warn-soft text-tone-warn rounded-lg border p-3 text-sm"
        >
          {cfg.missing} Backups cannot run until your administrator sets this up (see the deployment
          guide).
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Schedule and retention</CardTitle>
          <p className="text-muted-foreground text-xs">
            {settings?.last_ok_at ? (
              <>
                Last successful backup: <LocalTime value={settings.last_ok_at} />.{" "}
              </>
            ) : (
              "No successful backup yet. "
            )}
            {settings?.enabled && settings.next_run_at ? (
              <>
                Next: <LocalTime value={settings.next_run_at} />.
              </>
            ) : (
              "Scheduled backups are off."
            )}
          </p>
        </CardHeader>
        <CardContent>
          <EntityForm
            action={saveBackupSettingsAction}
            submitLabel="Save"
            fields={[
              {
                name: "enabled",
                label: "Take backups automatically",
                type: "checkbox",
                defaultValue: settings?.enabled ?? false,
              },
              {
                name: "frequency",
                label: "How often",
                type: "select",
                required: true,
                options: [
                  { value: "DAILY", label: "Every day" },
                  { value: "WEEKLY", label: "Every week" },
                ],
                defaultValue: settings?.frequency ?? "DAILY",
              },
              {
                name: "retentionDays",
                label: "Keep backups for (days)",
                type: "number",
                required: true,
                min: 7,
                defaultValue: settings?.retention_days ?? 30,
              },
              {
                name: "keepMin",
                label: "Always keep the newest",
                type: "number",
                required: true,
                min: 1,
                defaultValue: settings?.keep_min ?? 3,
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-muted-foreground text-sm">No backups yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Backup history</caption>
                <thead className="text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="py-1 pr-3 font-medium">When</th>
                    <th className="py-1 pr-3 font-medium">Type</th>
                    <th className="py-1 pr-3 font-medium">Result</th>
                    <th className="py-1 pr-3 text-right font-medium">Records</th>
                    <th className="py-1 pr-3 text-right font-medium">Size</th>
                    <th className="py-1 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const usable = r.status === "OK" && !r.deleted_at;
                    return (
                      <tr key={r.id} className="border-t align-top">
                        <td className="py-2 pr-3">
                          <LocalTime value={r.started_at} />
                        </td>
                        <td className="py-2 pr-3">{KIND[r.kind] ?? r.kind}</td>
                        <td className="py-2 pr-3">
                          <StatusBadge
                            value={
                              r.status === "OK"
                                ? "COMPLETED"
                                : r.status === "RUNNING"
                                  ? "PROCESSING"
                                  : "FAILED"
                            }
                          />
                          {r.deleted_at ? (
                            <span className="text-muted-foreground ml-1 text-xs">expired</span>
                          ) : null}
                          {usable && (
                            <p className="text-muted-foreground mt-1 text-xs">
                              {r.verify_ok ? "Checked after saving" : "Not checked"}
                            </p>
                          )}
                          {r.error && <p className="text-destructive mt-1 text-xs">{r.error}</p>}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {r.row_counts ? sum(r.row_counts).toLocaleString("en-IN") : "–"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{size(r.size_bytes)}</td>
                        <td className="py-2">
                          {usable && (
                            <div className="flex flex-wrap justify-end gap-2">
                              <VerifyBackupButton id={r.id} disabled={!configured} />
                              <a
                                className="border-input hover:bg-muted inline-flex h-7 items-center rounded-lg border px-2.5 text-xs font-medium"
                                href={`/api/backups/${r.id}/download`}
                              >
                                Download
                              </a>
                              {r.kind !== "PRE_RESTORE" && (
                                <RestorePlanButton
                                  id={r.id}
                                  disabled={!configured || r.verify_ok !== true}
                                />
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {(restores ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Restore plans</CardTitle>
            <p className="text-muted-foreground text-xs">
              A plan never changes data. Restoring a production system is a manual, supervised step.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {(restores ?? []).map((p) => (
              <div key={p.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    Prepared <LocalTime value={p.created_at} /> <StatusBadge value={p.status} />
                  </p>
                  {p.status === "PLANNED" && <ClosePlanButtons id={p.id} />}
                </div>
                {p.status === "PLANNED" && (
                  <ol className="text-muted-foreground mt-2 list-decimal pl-5 text-xs">
                    <li>
                      A verified safety copy of today&apos;s data exists (see History, type
                      &ldquo;Safety copy before a restore&rdquo;).
                    </li>
                    <li>
                      Ask your administrator to put the system in maintenance and follow
                      &ldquo;Restoring an agency&rdquo; in the runbook, using the chosen backup and
                      your backup key.
                    </li>
                    <li>
                      Compare the record counts reported by the restore check with the History
                      table, then reopen the system.
                    </li>
                  </ol>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-xs">
        Recovery targets (RPO and RTO) are goals, not guarantees: they are only demonstrated after a
        restore drill has been run and recorded.
      </p>
    </div>
  );
}
