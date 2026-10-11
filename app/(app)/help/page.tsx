import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, CheckCircle2, Circle, Download, Search } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { CATEGORIES, getArticle, searchArticles, visibleArticles } from "@/lib/help/articles";
import { CHECKLIST } from "@/lib/help/checklist";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Help center" };

export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireOrgSession();
  const has = (p: string) => session.permissions.has(p as never);
  const q = ((await searchParams).q ?? "").trim().slice(0, 60);
  const list = visibleArticles(has);
  const results = q.length >= 2 ? searchArticles(list, q) : null;

  const steps = CHECKLIST.filter((c) => has(c.permission));
  const supabase = await createClient();
  const done = await Promise.all(
    steps.map(async (c) => {
      const { count } = await supabase.from(c.table).select("id", { count: "exact", head: true });
      return (count ?? 0) >= c.atLeast;
    }),
  );
  const finished = done.filter(Boolean).length;
  const faq = getArticle("faq");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Help center"
        description="Guides for every part of the CRM. You only see guides that match what your role allows."
        actions={
          <a
            href="/help/manual.pdf"
            className="border-input hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium"
          >
            <Download className="size-4" aria-hidden /> User manual (PDF)
          </a>
        }
      />
      <form role="search" aria-label="Search the help center" className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-[9px] left-2.5 size-4"
          aria-hidden
        />
        <input
          type="search"
          name="q"
          defaultValue={q}
          maxLength={60}
          placeholder="Search the guides, e.g. refund, time zone, backup"
          aria-label="Search the guides"
          className="border-input bg-card focus-visible:ring-ring/20 focus-visible:border-primary h-9 w-full rounded-lg border pr-3 pl-8 text-sm outline-none focus-visible:ring-3"
        />
      </form>

      {results ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {results.length} {results.length === 1 ? "result" : "results"} for &ldquo;{q}&rdquo;
            </CardTitle>
          </CardHeader>
          <CardContent>
            {results.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="Nothing found"
                description="Try a shorter or different word, or browse the categories below."
              />
            ) : (
              <ul className="flex flex-col divide-y">
                {results.map((a) => (
                  <li key={a.slug} className="py-2">
                    <Link
                      href={`/help/${a.slug}`}
                      className="text-primary font-medium underline-offset-2 hover:underline"
                    >
                      {a.title}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {a.category} · {a.summary}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {steps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Getting started: {finished} of {steps.length} done
                </CardTitle>
                <div
                  role="progressbar"
                  aria-label="Getting started progress"
                  aria-valuemin={0}
                  aria-valuemax={steps.length}
                  aria-valuenow={finished}
                  className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
                >
                  <div
                    className="bg-primary h-full"
                    style={{ width: `${(finished / steps.length) * 100}%` }}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y">
                  {steps.map((c, i) => (
                    <li key={c.key} className="flex items-start gap-3 py-2 text-sm">
                      {done[i] ? (
                        <CheckCircle2
                          className="text-tone-ok mt-0.5 size-4 shrink-0"
                          aria-label="Done"
                        />
                      ) : (
                        <Circle
                          className="text-muted-foreground mt-0.5 size-4 shrink-0"
                          aria-label="Not done yet"
                        />
                      )}
                      <div className="flex-1">
                        <Link
                          href={c.href}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {c.title}
                        </Link>
                        <p className="text-muted-foreground text-xs">{c.hint}</p>
                      </div>
                      <Link
                        href={`/help/${c.guide}`}
                        className="text-primary text-xs underline underline-offset-2"
                      >
                        How
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {CATEGORIES.map((cat) => {
              const items = list.filter((a) => a.category === cat);
              if (!items.length) return null;
              return (
                <Card key={cat}>
                  <CardHeader>
                    <CardTitle>{cat}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="flex flex-col gap-1.5 text-sm">
                      {items.map((a) => (
                        <li key={a.slug}>
                          <Link
                            href={`/help/${a.slug}`}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            {a.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {faq && (
            <p className="text-muted-foreground text-sm">
              Quick answers are in the{" "}
              <Link href="/help/faq" className="text-primary underline underline-offset-2">
                frequently asked questions
              </Link>
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}
