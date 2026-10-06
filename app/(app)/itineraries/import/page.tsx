import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ImportUpload } from "@/components/itinerary/import-upload";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { requireOrgSession } from "@/lib/auth/session";
import { isAiConfigured } from "@/lib/import/ai";
import { listRecentImports } from "@/lib/import/queries";

export const metadata: Metadata = { title: "Import itinerary" };

export default async function ImportPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("itineraries.create")) redirect("/itineraries");
  const recent = await listRecentImports();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHeader
        title="Import an itinerary"
        description="Upload an existing PDF, Word or Excel itinerary. You'll review everything before it becomes a draft."
      />
      <div className="bg-card rounded-xl border p-5">
        <ImportUpload />
        <p className="text-muted-foreground mt-4 text-xs">
          {isAiConfigured()
            ? "AI structuring is on: document text (with emails, phone numbers and ID numbers removed) is sent to OpenAI to organise it. Results are always validated and must be reviewed."
            : "AI structuring is off. A built-in parser reads the document locally. Nothing leaves this server."}{" "}
          The original file is not stored.
        </p>
      </div>
      {recent.length > 0 && (
        <div className="bg-card rounded-xl border p-5">
          <h2 className="mb-3 text-sm font-semibold">Recent imports</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <Link
                  className="hover:underline"
                  href={
                    r.status === "CONVERTED" && r.itinerary_id
                      ? `/itineraries/${r.itinerary_id}`
                      : `/itineraries/import/${r.id}`
                  }
                >
                  {r.file_name}
                </Link>
                <StatusBadge
                  value={
                    r.status === "REVIEW"
                      ? "TODO"
                      : r.status === "CONVERTED"
                        ? "COMPLETED"
                        : "CANCELLED"
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
