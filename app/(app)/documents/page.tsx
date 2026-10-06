import type { Metadata } from "next";
import { FolderLock } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { DocumentList } from "@/components/documents/document-list";
import { DocumentUpload } from "@/components/documents/document-upload";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { DOCUMENT_CATEGORIES } from "@/lib/documents/validate";
import { listDocuments } from "@/lib/booking/queries";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; page?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("documents.view")) {
    return (
      <EmptyState
        icon={FolderLock}
        title="No access"
        description="You don't have permission to view documents."
      />
    );
  }
  const sp = await searchParams;
  const category = DOCUMENT_CATEGORIES.find((c) => c === sp.category);
  const { rows, total, page } = await listDocuments({
    category,
    page: Number.parseInt(sp.page ?? "1", 10) || 1,
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Documents"
        description="Private files. Downloads use short-lived links and are logged."
      />
      {session.permissions.has("documents.upload") && (
        <Card>
          <CardContent>
            <DocumentUpload canSensitive={session.permissions.has("passengers.view_sensitive")} />
          </CardContent>
        </Card>
      )}
      <form className="flex gap-2" role="search">
        <select
          name="category"
          defaultValue={category ?? ""}
          aria-label="Filter by category"
          className="border-input bg-background h-8 rounded-lg border px-2.5 text-sm"
        >
          <option value="">All categories</option>
          {DOCUMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm">
          Filter
        </Button>
      </form>
      <DocumentList docs={rows} canDownload={session.permissions.has("documents.download")} />
      <Pagination page={page} total={total} basePath="/documents" params={{ category }} />
    </div>
  );
}
