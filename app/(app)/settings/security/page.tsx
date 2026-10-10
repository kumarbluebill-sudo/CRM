import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/crm/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Security" };

type Summary = {
  byKind: Record<string, number>;
  exports: number;
  adminsWithoutMfa: number;
  admins: number;
};

export default async function SecuritySettingsPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("settings.manage")) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No access"
        description="Only owners and admins can view security events."
      />
    );
  }
  const supabase = await createClient();
  const [{ data: summary }, { data: events }] = await Promise.all([
    supabase.rpc("security_summary", { p_days: 7 }),
    supabase
      .from("security_events")
      .select("id, kind, detail, ip, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const s = (summary ?? { byKind: {}, exports: 0, adminsWithoutMfa: 0, admins: 0 }) as Summary;
  const stat = (name: string, value: number, hint: string) => (
    <Card key={name}>
      <CardContent className="p-4">
        <p className="text-muted-foreground text-xs">{name}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Security"
        description="What happened in the last 7 days. Addresses are shortened for privacy and records are kept for 6 months."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stat(
          "Failed sign-ins",
          (s.byKind.LOGIN_FAILED ?? 0) + (s.byKind.MFA_FAILED ?? 0),
          "Wrong password or code",
        )}
        {stat(
          "Blocked by rate limit",
          s.byKind.LOGIN_THROTTLED ?? 0,
          "Too many tries in a short time",
        )}
        {stat(
          "Permission denials",
          s.byKind.PERMISSION_DENIED ?? 0,
          "Someone tried something their role does not allow",
        )}
        {stat("Data exports", s.exports, "CSV downloads")}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Two-step verification</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {s.admins - s.adminsWithoutMfa} of {s.admins} owners and admins have it on.{" "}
          <Link href="/profile/security" className="underline">
            Manage the agency policy
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent events</CardTitle>
        </CardHeader>
        <CardContent>
          {events?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-2 pr-4 font-medium">When</th>
                    <th className="py-2 pr-4 font-medium">Event</th>
                    <th className="py-2 pr-4 font-medium">Detail</th>
                    <th className="py-2 font-medium">Network</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {new Date(e.created_at).toLocaleString("en-IN")}
                      </td>
                      <td className="py-2 pr-4">{label(e.kind)}</td>
                      <td className="py-2 pr-4">{e.detail ?? ""}</td>
                      <td className="py-2">{e.ip ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing to show yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
