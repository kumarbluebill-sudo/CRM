import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";
import {
  DEFAULT_TEMPLATES,
  oneLine,
  renderTemplate,
  whatsappLink,
  type Channel,
  type TemplateKey,
} from "@/lib/comms/templates";
import { EmailNotConfiguredError, sendEmail } from "@/lib/comms/email";

export type DeliverResult = { status: "SENT" | "FAILED"; waUrl?: string; message: string };

/** The organization's own template if it saved one, otherwise the built-in default. */
export async function loadTemplate(
  supabase: SupabaseClient,
  key: TemplateKey,
  channel: Channel,
): Promise<{ subject: string; body: string }> {
  const { data } = await supabase
    .from("message_templates")
    .select("subject, body")
    .eq("template_key", key)
    .eq("channel", channel)
    .maybeSingle();
  const fallback = DEFAULT_TEMPLATES[key];
  return {
    subject: (data?.subject as string | null) || fallback.subject,
    body: (data?.body as string | null) || fallback.body,
  };
}

/**
 * Renders and sends one QUEUED message. The address comes from the stored row (copied from the customer record by
 * the database), never from the caller. Email goes through Resend. WhatsApp produces a click-to-chat link that a
 * person taps to send from their own WhatsApp; no WhatsApp API credentials are involved.
 */
export async function deliverCommunication(
  supabase: SupabaseClient,
  id: string,
  orgName: string,
  replyTo: string | null,
): Promise<DeliverResult> {
  const { data: row } = await supabase
    .from("communications")
    .select("id, channel, template_key, to_address, vars, status")
    .eq("id", id)
    .maybeSingle();
  if (!row) throw new AppError("Message not found.", "NOT_FOUND", 404);
  if (row.status !== "QUEUED" && row.status !== "FAILED")
    throw new AppError("This message was already handled.", "CONFLICT", 409);

  const channel = row.channel as Channel;
  const tpl = await loadTemplate(supabase, row.template_key as TemplateKey, channel);
  const vars = { org_name: orgName, ...(row.vars as Record<string, unknown>) };
  const body = renderTemplate(tpl.body, vars);
  const subject = oneLine(renderTemplate(tpl.subject, vars)) || `Message from ${orgName}`;

  const finish = async (
    status: "SENT" | "FAILED",
    provider: string | null,
    error: string | null,
  ) => {
    const { error: dbError } = await supabase.rpc("finish_communication", {
      p_id: id,
      p_status: status,
      p_provider: provider,
      p_subject: channel === "EMAIL" ? subject : null,
      p_body: body,
      p_error: error,
    });
    if (dbError) logger.error("finish_communication failed", { code: dbError.code });
  };

  if (channel === "WHATSAPP") {
    const waUrl = whatsappLink(row.to_address as string, body);
    if (!waUrl) {
      await finish("FAILED", null, "Invalid WhatsApp number");
      return { status: "FAILED", message: "The customer's WhatsApp number isn't valid." };
    }
    await finish("SENT", "whatsapp-click-to-chat", null);
    return { status: "SENT", waUrl, message: "Opening WhatsApp. Send the message there." };
  }

  try {
    const providerId = await sendEmail({
      to: row.to_address as string,
      subject,
      text: body,
      fromName: orgName,
      replyTo,
    });
    await finish("SENT", providerId, null);
    return { status: "SENT", message: "Email sent." };
  } catch (error) {
    if (error instanceof EmailNotConfiguredError)
      throw new AppError(
        "Email isn't configured yet. Ask an admin to add the email settings.",
        "NOT_CONFIGURED",
        503,
      );
    logger.error("email send failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    await finish("FAILED", null, "Provider error");
    return {
      status: "FAILED",
      message: "The email couldn't be sent. You can retry from the outbox.",
    };
  }
}
