import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { EntityForm } from "@/components/forms/entity-form";
import { PageHeader } from "@/components/crm/page-header";
import { RuleRow } from "@/components/comms/rule-row";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { listRules, listTemplates } from "@/lib/comms/queries";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_KEYS,
  TEMPLATE_LABELS,
  TEMPLATE_VARS,
} from "@/lib/comms/templates";
import { saveTemplateAction } from "@/app/(app)/communications/actions";

export const metadata: Metadata = { title: "Templates and automation" };

const RULES = [
  {
    trigger: "PAYMENT_DUE_SOON",
    title: "Payment due soon",
    help: "Draft a reminder up to this many days before",
  },
  {
    trigger: "PAYMENT_OVERDUE",
    title: "Payment overdue",
    help: "Draft a reminder this many days after the due date",
  },
  {
    trigger: "TRAVEL_UPCOMING",
    title: "Trip coming up",
    help: "Draft a reminder this many days before departure",
  },
] as const;

export default async function TemplatesPage() {
  const session = await requireOrgSession();
  if (!session.permissions.has("communications.manage")) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="No access"
        description="Only managers can edit templates and automation."
      />
    );
  }
  const [templates, rules] = await Promise.all([listTemplates(), listRules()]);
  const channels = ["EMAIL", "WHATSAPP"] as const;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Templates and automation"
        description="Automation only drafts messages. A person reviews and sends every one."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Automation (email drafts, checked daily)</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {RULES.map((r) => {
            const saved = rules.find((x) => x.trigger === r.trigger && x.channel === "EMAIL");
            return (
              <RuleRow
                key={r.trigger}
                trigger={r.trigger}
                channel="EMAIL"
                title={r.title}
                help={r.help}
                enabled={saved?.enabled ?? false}
                days={saved?.days ?? (r.trigger === "PAYMENT_OVERDUE" ? 1 : 3)}
              />
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Message templates</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">
            Placeholders: {TEMPLATE_VARS.map((v) => `{{${v}}}`).join(", ")}. Anything else is left
            blank.
          </p>
          {TEMPLATE_KEYS.flatMap((key) =>
            channels.map((channel) => {
              const own = templates.find((t) => t.template_key === key && t.channel === channel);
              const def = DEFAULT_TEMPLATES[key];
              return (
                <details key={`${key}-${channel}`} className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {TEMPLATE_LABELS[key]} · {channel === "EMAIL" ? "Email" : "WhatsApp"}
                    {own ? " (customised)" : ""}
                  </summary>
                  <div className="pt-3">
                    <EntityForm
                      action={saveTemplateAction.bind(null, key, channel)}
                      submitLabel="Save template"
                      fields={[
                        ...(channel === "EMAIL"
                          ? [
                              {
                                name: "subject",
                                label: "Subject",
                                wide: true,
                                defaultValue: own?.subject ?? def.subject,
                              },
                            ]
                          : []),
                        {
                          name: "body",
                          label: "Message",
                          type: "textarea" as const,
                          required: true,
                          wide: true,
                          defaultValue: own?.body ?? def.body,
                        },
                      ]}
                    />
                  </div>
                </details>
              );
            }),
          )}
        </CardContent>
      </Card>
    </div>
  );
}
