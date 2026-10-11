import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { ArticleBody } from "@/components/help/article-body";
import { PageHeader } from "@/components/crm/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { articleBlocks, getArticle, visibleArticles } from "@/lib/help/articles";
import { filterBlocks } from "@/lib/help/markdown";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const a = getArticle((await params).slug);
  return { title: a ? a.title : "Help center" };
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await requireOrgSession();
  const a = getArticle((await params).slug);
  if (!a) notFound();
  const has = (p: string) => session.permissions.has(p as never);
  if (a.requires && !has(a.requires)) {
    return (
      <EmptyState
        icon={Lock}
        title="This guide is for a different role"
        description="Your role does not include the part of the CRM this guide covers. Ask an administrator if you need access."
      />
    );
  }
  const blocks = filterBlocks(articleBlocks(a), has);
  const related = visibleArticles(has).filter((r) => a.related.includes(r.slug));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={a.title}
        description={a.summary}
        breadcrumb={[{ label: "Help center", href: "/help" }, { label: a.category }]}
      />
      <ArticleBody blocks={blocks} />
      {related.length > 0 && (
        <section aria-label="Related guides" className="border-t pt-3 text-sm">
          <p className="mb-1 font-medium">Related guides</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {related.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/help/${r.slug}`}
                  className="text-primary underline underline-offset-2"
                >
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-muted-foreground text-xs">
        Guide version {a.version}, updated {a.updated}.
      </p>
    </div>
  );
}
