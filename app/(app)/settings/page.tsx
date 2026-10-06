import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, FileText, Palette, ScrollText, Users, Wallet } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireOrgSession();
  const links = [
    {
      href: "/settings/branding",
      title: "Agency branding",
      text: "Logo, colours, contact details and footer used on PDFs.",
      icon: Palette,
      show: session.permissions.has("settings.manage"),
    },
    {
      href: "/settings/team",
      title: "Team",
      text: "Members, roles and invitations.",
      icon: Users,
      show: session.permissions.has("users.manage"),
    },
    {
      href: "/settings/payments",
      title: "Online payments",
      text: "Connect your own Razorpay account for customer payments.",
      icon: Wallet,
      show: session.permissions.has("settings.manage"),
    },
    {
      href: "/settings/audit",
      title: "Audit log",
      text: "Who did what, and when.",
      icon: ScrollText,
      show: session.permissions.has("settings.manage"),
    },
    {
      href: "/settings/billing",
      title: "Plan and billing",
      text: "Your plan, usage against limits and subscription.",
      icon: CreditCard,
      show: session.permissions.has("settings.manage") || session.permissions.has("billing.manage"),
    },
    {
      href: "/quotations/templates",
      title: "Quotation templates",
      text: "Reusable terms, cancellation and payment wording.",
      icon: FileText,
      show: session.permissions.has("quotes.view"),
    },
  ].filter((l) => l.show);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader title="Settings" description={session.organization.name} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {links.map(({ href, title, text, icon: Icon }) => (
          <li key={href}>
            <Link href={href}>
              <Card size="sm" className="hover:bg-muted/50 h-full">
                <CardContent className="flex gap-3">
                  <Icon className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
                  <span>
                    <span className="block font-medium">{title}</span>
                    <span className="text-muted-foreground text-sm">{text}</span>
                  </span>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
