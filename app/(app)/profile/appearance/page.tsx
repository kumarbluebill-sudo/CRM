import type { Metadata } from "next";
import { PageHeader } from "@/components/crm/page-header";
import { ThemeEditor } from "@/components/theme/theme-editor";
import { requireOrgSession } from "@/lib/auth/session";
import { getStoredThemes } from "@/lib/theme/server";
import { saveMyThemeAction } from "@/app/(app)/profile/appearance/actions";

export const metadata: Metadata = { title: "Your appearance" };

export default async function ProfileAppearancePage() {
  await requireOrgSession();
  const { user, org } = await getStoredThemes();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: "Your profile", href: "/profile" }, { label: "Appearance" }]}
        title="Your appearance"
        description="Choose how the CRM looks for you. This does not change anyone else's screen."
      />
      <div className="bg-card rounded-xl border p-5">
        <ThemeEditor scope="user" saved={user} agency={org} apply={saveMyThemeAction} />
      </div>
    </div>
  );
}
