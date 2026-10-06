import "server-only";
import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/utils/logger";

export class AiNotConfiguredError extends Error {}
export class AiFailedError extends Error {}

export type ChatResult = {
  text: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
};

export const aiModel = () => process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

/** One plain-text completion. No tools, no function calling: the model can only return text. */
export async function chat(input: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<ChatResult> {
  const key = getServerEnv().OPENAI_API_KEY;
  if (!key) throw new AiNotConfiguredError("AI isn't configured.");
  const model = aiModel();
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: input.temperature ?? 0.3,
        max_tokens: input.maxTokens ?? 700,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
  } catch (error) {
    logger.warn("openai request error", { error: error instanceof Error ? error.name : "unknown" });
    throw new AiFailedError("AI request failed");
  }
  if (!res.ok) {
    logger.warn("openai request failed", { status: res.status });
    throw new AiFailedError("AI request failed");
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new AiFailedError("Empty AI response");
  return {
    text,
    model,
    promptTokens: json.usage?.prompt_tokens ?? null,
    completionTokens: json.usage?.completion_tokens ?? null,
  };
}
