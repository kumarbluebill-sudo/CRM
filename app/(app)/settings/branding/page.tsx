import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoUploader } from "@/components/settings/logo-uploader";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { requireOrgSession } from "@/lib/auth/session";
import { getBranding } from "@/lib/quotation/queries";
import { saveBrandingAction } from "@/app/(app)/settings/actions";

export const metadata: Metadata = { title: "Agency branding" };

export default async function BrandingPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("settings.manage")) redirect("/settings");
  const b = await getBranding();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHeader
        title="Agency branding"
        description="Shown in the sidebar and on quotation and invoice PDFs."
      />
      <div className="bg-card rounded-xl border p-5">
        <LogoUploader logo={b?.logo_data ?? null} />
      </div>
      <div className="bg-card rounded-xl border p-5">
        <EntityForm
          action={saveBrandingAction}
          submitLabel="Save branding"
          fields={[
            {
              name: "legalName",
              label: "Legal business name",
              defaultValue: b?.legal_name,
              wide: true,
            },
            {
              name: "tradeName",
              label: "Trade name (shown in the app)",
              defaultValue: b?.trade_name,
              wide: true,
            },
            {
              name: "primaryColor",
              label: "Primary colour (#RRGGBB)",
              defaultValue: b?.primary_color,
              placeholder: "#0f766e",
            },
            {
              name: "secondaryColor",
              label: "Secondary colour",
              defaultValue: b?.secondary_color,
              placeholder: "#134e4a",
            },
            {
              name: "accentColor",
              label: "Accent colour",
              defaultValue: b?.accent_color,
              placeholder: "#f59e0b",
            },
            { name: "phone", label: "Phone", type: "tel", defaultValue: b?.phone },
            { name: "whatsapp", label: "WhatsApp number", type: "tel", defaultValue: b?.whatsapp },
            { name: "email", label: "Email", type: "email", defaultValue: b?.email },
            { name: "website", label: "Website (https://…)", defaultValue: b?.website },
            { name: "gstNumber", label: "GST / tax number", defaultValue: b?.gst_number },
            { name: "address", label: "Address", type: "textarea", defaultValue: b?.address },
            { name: "facebookUrl", label: "Facebook link", defaultValue: b?.facebook_url },
            { name: "instagramUrl", label: "Instagram link", defaultValue: b?.instagram_url },
            { name: "youtubeUrl", label: "YouTube link", defaultValue: b?.youtube_url },
            {
              name: "footerText",
              label: "Footer text",
              type: "textarea",
              defaultValue: b?.footer_text,
            },
          ]}
        />
      </div>
    </div>
  );
}
