import { logger } from "@/lib/utils/logger";

/** An error whose message is safe to show to end users. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = "APP_ERROR",
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/**
 * Logs the full error server-side and returns only a user-safe message.
 * Never returns database errors, stack traces or internal paths.
 */
export function toSafeError(
  error: unknown,
  context?: Record<string, unknown>,
): {
  message: string;
  code: string;
  status: number;
} {
  if (error instanceof AppError) {
    return { message: error.message, code: error.code, status: error.status };
  }
  logger.error("Unhandled error", { ...context, error });
  return { message: GENERIC_MESSAGE, code: "INTERNAL_ERROR", status: 500 };
}
