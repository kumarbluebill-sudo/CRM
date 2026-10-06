import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { CommsList } from "@/components/comms/comms-list";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { listCommunications, listTemplates } from "@/lib/comms/queries";

const STATUSES = ["QUEUED", "SENT", "FAILED", "CANCELLED"] as const;

/** Shared by /communications, /communications/email and /communications/whatsapp. */
export async function CommsPage({
  channel,
  title,
  basePath,
  searchParams,
}: {
  channel?: "EMAIL" | "WHATSAPP";
  title: string;
  basePath: string;
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("communications.view")) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="No access"
        description="You don't have permission to view communications."
      />
    );
  }
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const [{ rows, total, page }, templates] = await Promise.all([
    listCommunications({ channel, status, page: Number.parseInt(sp.page ?? "1", 10) || 1 }),
    listTemplates(),
  ]);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title={title}
        description="Review drafts before they go out. Send new messages from a booking."
        actions={
          session.permissions.has("communications.manage") && (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/communications/templates" />}
            >
              Templates and automation
            </Button>
          )
        }
      />
      <nav aria-label="Status filter" className="flex flex-wrap gap-2 text-sm">
        <Link href={basePath} className={!status ? "font-semibold underline" : "hover:underline"}>
          All
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`${basePath}?status=${s}`}
            className={status === s ? "font-semibold underline" : "hover:underline"}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </Link>
        ))}
      </nav>
      <CommsList
        rows={rows}
        templates={templates}
        orgName={session.organization?.name ?? ""}
        canSend={session.permissions.has("communications.send")}
      />
      <Pagination page={page} total={total} basePath={basePath} params={{ status }} />
    </div>
  );
}
