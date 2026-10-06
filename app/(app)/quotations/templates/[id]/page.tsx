import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConfirmActionButton } from "@/components/crm/confirm-action-button";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { templateFields } from "@/components/quotation/template-fields";
import { requireOrgSession } from "@/lib/auth/session";
import { uuid } from "@/lib/crm/schemas";
import { getTemplate } from "@/lib/quotation/queries";
import { deleteTemplateAction, saveTemplateAction } from "@/app/(app)/quotations/actions";

export const metadata: Metadata = { title: "Edit template" };

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  const template = await getTemplate(id);
  if (!template) notFound();
  const canEdit = session.permissions.has("quotes.update");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHeader
        title={template.name}
        actions={
          session.permissions.has("quotes.delete") && (
            <ConfirmActionButton
              action={deleteTemplateAction.bind(null, id)}
              triggerLabel="Delete"
              title="Delete this template?"
              description="Existing quotations keep their text. Only the template is removed."
            />
          )
        }
      />
      <div className="bg-card rounded-xl border p-5">
        {canEdit ? (
          <EntityForm
            action={saveTemplateAction.bind(null, id)}
            submitLabel="Save template"
            fields={templateFields(template)}
          />
        ) : (
          <p className="text-muted-foreground text-sm">You have read-only access.</p>
        )}
      </div>
    </div>
  );
}
