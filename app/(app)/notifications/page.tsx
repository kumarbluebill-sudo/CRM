import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { MarkAllReadButton, MarkReadButton } from "@/components/notifications/mark-all-button";
import { PreferencesForm } from "@/components/notifications/preferences-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { getPreferences, listNotifications } from "@/lib/notifications/queries";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; filter?: string }>;
}) {
  await requireOrgSession();
  const sp = await searchParams;
  const unreadOnly = sp.filter === "unread";
  const [{ rows, total, page }, prefs] = await Promise.all([
    listNotifications({ page: Number.parseInt(sp.page ?? "1", 10) || 1, unreadOnly }),
    getPreferences(),
  ]);
  const unread = rows.filter((r) => !r.read).length;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Notifications"
        description="Things that need your attention. Only you can see these."
        actions={
          <>
            <Button
              size="sm"
              variant={unreadOnly ? "outline" : "secondary"}
              nativeButton={false}
              render={<Link href="/notifications" />}
            >
              All
            </Button>
            <Button
              size="sm"
              variant={unreadOnly ? "secondary" : "outline"}
              nativeButton={false}
              render={<Link href="/notifications?filter=unread" />}
            >
              Unread
            </Button>
            <MarkAllReadButton
              disabled={unread === 0 && !unreadOnly && rows.every((r) => r.read)}
            />
          </>
        }
      />
      <Card>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={Bell}
              title={unreadOnly ? "Nothing unread" : "No notifications yet"}
              description="New enquiries, payments, visa updates and job assignments will appear here."
            />
          ) : (
            <ul className="divide-y text-sm" aria-label="Notification history">
              {rows.map((n) => (
                <li key={n.id} className="flex flex-wrap items-start gap-3 py-2.5">
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-tone-primary"}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={n.href}
                      className={`hover:underline ${n.read ? "" : "font-semibold"}`}
                    >
                      {n.title}
                      {!n.read && <span className="sr-only"> (unread)</span>}
                    </Link>
                    {n.body && <p className="text-muted-foreground text-xs">{n.body}</p>}
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {n.createdAt.slice(0, 16).replace("T", " ")}
                  </span>
                  {!n.read && <MarkReadButton id={n.id} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pagination
        page={page}
        total={total}
        basePath="/notifications"
        params={{ filter: unreadOnly ? "unread" : undefined }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification preferences</CardTitle>
          <p className="text-muted-foreground text-xs">
            Choose what appears in the app and what is also emailed to you (once a day, with the
            daily check). Emails contain only the headline and a link.
          </p>
        </CardHeader>
        <CardContent>
          <PreferencesForm prefs={Object.fromEntries(prefs)} />
        </CardContent>
      </Card>
    </div>
  );
}
