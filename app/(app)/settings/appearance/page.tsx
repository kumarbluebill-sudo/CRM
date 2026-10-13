import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/crm/page-header";
import { ThemeEditor } from "@/components/theme/theme-editor";
import { requireOrgSession } from "@/lib/auth/session";
import { getStoredThemes } from "@/lib/theme/server";
import { saveOrgThemeAction } from "@/app/(app)/settings/appearance/actions";

export const metadata: Metadata = { title: "Appearance" };

export default async function AppearanceSettingsPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("settings.manage")) redirect("/settings");
  const { org } = await getStoredThemes();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Appearance" }]}
        title="Appearance"
        description="The default look for everyone in your agency. People can choose their own theme from their profile."
      />
      <div className="bg-card rounded-xl border p-5">
        <ThemeEditor scope="org" saved={org} agency={null} apply={saveOrgThemeAction} />
      </div>
    </div>
  );
}
