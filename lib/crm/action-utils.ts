import "server-only";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/auth/schemas";
import { AppError, toSafeError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";

export function formObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

type DbError = { code?: string; message: string } | null;

/** Converts a Supabase/Postgres error into an AppError with a user-safe message. */
export function throwIfDbError(error: DbError, context: string): void {
  if (!error) return;
  logger.error(`${context} failed`, { code: error.code, error: error.message });
  if (error.code === "42501")
    throw new AppError("You don't have permission to do that.", "FORBIDDEN", 403);
  if (error.code === "23503")
    throw new AppError(
      "A selected customer, source or assignee is not valid.",
      "INVALID_REFERENCE",
    );
  if (error.code === "23514" || error.code === "22P02")
    throw new AppError("Some values are invalid. Please check the form.", "INVALID_VALUE");
  throw new Error(error.message);
}

/**
 * Runs a server action body, converting thrown errors into a safe FormState.
 * Next.js redirects are control-flow errors and must pass through.
 */
export async function runAction(fn: () => Promise<FormState | void>): Promise<FormState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { message: toSafeError(error).message };
  }
}

function isRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export { redirect };
