import "server-only";
import { getServerEnv } from "@/lib/env.server";
import { textToHtml } from "@/lib/comms/templates";

export class EmailNotConfiguredError extends Error {}
export class EmailSendError extends Error {}

/** Display names go in a header: keep letters, numbers and a few safe symbols only. */
const safeName = (s: string) =>
  s
    .replace(/[^\p{L}\p{N} .&'-]/gu, "")
    .trim()
    .slice(0, 60) || "Travel";

/** Sends one email through Resend. Returns the provider message id. */
export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  fromName: string;
  replyTo?: string | null;
}): Promise<string> {
  const { RESEND_API_KEY, EMAIL_FROM } = getServerEnv();
  if (!RESEND_API_KEY || !EMAIL_FROM) throw new EmailNotConfiguredError("Email isn't configured.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: `${safeName(input.fromName)} <${EMAIL_FROM}>`,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: textToHtml(input.text),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new EmailSendError(`Email provider rejected the message (${res.status}).`);
  const data = (await res.json()) as { id?: unknown };
  return typeof data.id === "string" ? data.id.slice(0, 200) : "unknown";
}
