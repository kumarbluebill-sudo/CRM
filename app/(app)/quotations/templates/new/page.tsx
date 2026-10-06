import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { templateFields } from "@/components/quotation/template-fields";
import { requireOrgSession } from "@/lib/auth/session";
import { saveTemplateAction } from "@/app/(app)/quotations/actions";

export const metadata: Metadata = { title: "New template" };

export default async function NewTemplatePage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("quotes.update")) redirect("/quotations/templates");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHeader title="New template" />
      <div className="bg-card rounded-xl border p-5">
        <EntityForm
          action={saveTemplateAction.bind(null, null)}
          submitLabel="Create template"
          fields={templateFields()}
        />
      </div>
    </div>
  );
}
