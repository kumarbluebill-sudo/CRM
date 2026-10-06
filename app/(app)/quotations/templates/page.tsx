import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { listTemplates } from "@/lib/quotation/queries";

export const metadata: Metadata = { title: "Quotation templates" };

export default async function TemplatesPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("quotes.view")) {
    return <EmptyState icon={FileText} title="No access" />;
  }
  const templates = await listTemplates();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Quotation templates"
        description="Reusable introduction, terms, cancellation and payment wording."
        actions={
          session.permissions.has("quotes.update") && (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href="/quotations/templates/new" />}
            >
              <Plus className="size-4" aria-hidden /> New template
            </Button>
          )
        }
      />
      {templates.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState icon={FileText} title="No templates yet" />
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((t) => (
            <li key={t.id}>
              <Card size="sm">
                <CardContent className="flex items-center justify-between">
                  <Link
                    href={`/quotations/templates/${t.id}`}
                    className="font-medium hover:underline"
                  >
                    {t.name}
                  </Link>
                  <span className="text-muted-foreground text-xs">
                    {t.terms ? "Terms set" : "No terms"}
                  </span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
