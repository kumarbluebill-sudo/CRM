import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { ConfidenceBadge } from "@/components/itinerary/confidence-badge";
import { ImportReviewActions } from "@/components/itinerary/import-review-actions";
import { PageHeader } from "@/components/crm/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { uuid } from "@/lib/crm/schemas";
import { flaggedEntries } from "@/lib/import/parse";
import { getImport } from "@/lib/import/queries";

export const metadata: Metadata = { title: "Review import" };

export default async function ImportReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  const imp = await getImport(id); // null for missing or other-organization ids (RLS)
  if (!imp) notFound();
  if (imp.status === "CONVERTED" && imp.itinerary_id) redirect(`/itineraries/${imp.itinerary_id}`);

  const p = imp.parsed;
  const flagged = flaggedEntries(p);
  const canConvert = session.permissions.has("itineraries.create");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Import complete — review required"
        description={`${imp.file_name} · ${imp.file_type} · read with ${p.engine === "openai" ? "AI" : "the built-in parser"}`}
        actions={
          canConvert && imp.status === "REVIEW" ? <ImportReviewActions id={id} /> : undefined
        }
      />

      <div
        role="note"
        className="border-tone-warn/30 bg-tone-warn-soft text-tone-warn flex gap-3 rounded-lg border p-4 text-sm"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          This content was extracted automatically and is <strong>not verified</strong>. Creating
          the draft lets you edit it in the builder; it cannot be published until you confirm you
          have reviewed it.
        </p>
      </div>

      {p.warnings.length > 0 && (
        <ul className="list-disc rounded-lg border p-3 pl-7 text-sm">
          {p.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What we found</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Row k="Title" v={p.title} c={p.confidence.title} />
          <Row k="Destination" v={p.destination ?? "—"} c={p.confidence.destination} />
          <Row k="Start date" v={p.startDate ?? "—"} c={p.confidence.startDate} />
          <Row
            k="Travellers"
            v={`${p.adults} adults, ${p.children} children`}
            c={p.confidence.travellers}
          />
          <Row k="Days" v={String(p.days.length)} c={p.confidence.days} />
          <Row k="Inclusions / exclusions" v={`${p.inclusions.length} / ${p.exclusions.length}`} />
        </CardContent>
      </Card>

      {flagged.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Please double-check ({flagged.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {flagged.slice(0, 40).map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="text-muted-foreground">
                      {f.where} · {f.kind}:
                    </span>{" "}
                    {f.text}
                  </span>
                  <ConfidenceBadge value={f.confidence} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {p.days.map((d, i) => (
        <Card key={i}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>
                Day {i + 1}
                {d.title ? ` – ${d.title}` : ""}
              </span>
              <ConfidenceBadge value={d.confidence} />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {d.description && (
              <p className="text-muted-foreground whitespace-pre-wrap">{d.description}</p>
            )}
            {d.items.map((it, j) => (
              <div key={j} className="flex items-start justify-between gap-2">
                <span>
                  <span className="text-muted-foreground mr-2 text-xs uppercase">
                    {label(it.type)}
                  </span>
                  {it.time && <span className="text-muted-foreground mr-2">{it.time}</span>}
                  {it.title}
                </span>
                <ConfidenceBadge value={it.confidence} />
              </div>
            ))}
            {d.items.length === 0 && <p className="text-muted-foreground">No items recognised.</p>}
          </CardContent>
        </Card>
      ))}

      {imp.source_text && (
        <details className="bg-card rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Show extracted source text
          </summary>
          <pre className="mt-3 max-h-96 overflow-auto text-xs whitespace-pre-wrap">
            {imp.source_text}
          </pre>
        </details>
      )}
      <p className="text-xs">
        <Link href="/itineraries/import" className="text-muted-foreground underline">
          Back to imports
        </Link>
      </p>
    </div>
  );
}

function Row({ k, v, c }: { k: string; v: string; c?: "high" | "medium" | "low" }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border p-2">
      <span>
        <span className="text-muted-foreground block text-xs">{k}</span>
        {v}
      </span>
      {c && <ConfidenceBadge value={c} />}
    </div>
  );
}
