/**
 * Error taxonomy.
 *
 * The rule this file enforces: users see `AppError.message`, logs see
 * `AppError.cause`. Anything that is not an `AppError` — a Prisma error, a
 * TypeError, a failed fetch — is deliberately collapsed into a generic message
 * by `toUserFacingError`, so a stack trace or a SQL constraint name can never
 * reach the browser.
 */

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "BLOCKED"
  | "INTERNAL";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  BLOCKED: 403,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** Field-level messages, keyed by form field name. */
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: { cause?: unknown; fieldErrors?: Record<string, string[]> },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fieldErrors = options?.fieldErrors;
  }
}

export const errors = {
  unauthenticated: (message = "You need to be signed in to do that.") =>
    new AppError("UNAUTHENTICATED", message),
  forbidden: (message = "You do not have permission to do that.") =>
    new AppError("FORBIDDEN", message),
  notFound: (message = "We could not find what you were looking for.") =>
    new AppError("NOT_FOUND", message),
  validation: (message = "Please check the highlighted fields.", fieldErrors?: Record<string, string[]>) =>
    new AppError("VALIDATION", message, { fieldErrors }),
  conflict: (message: string) => new AppError("CONFLICT", message),
  rateLimited: (message = "Slow down a second, then try again.") =>
    new AppError("RATE_LIMITED", message),
  blocked: (message = "This content is not available to you.") =>
    new AppError("BLOCKED", message),
  internal: (message = "Something went wrong. Try again.", cause?: unknown) =>
    new AppError("INTERNAL", message, { cause }),
};

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export interface UserFacingError {
  code: AppErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Converts any thrown value into something safe to send to the browser.
 * Non-`AppError` values become a generic 500 — their details belong in the log,
 * which is the caller's job (see `logger.error`).
 */
export function toUserFacingError(error: unknown): UserFacingError {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    };
  }

  return {
    code: "INTERNAL",
    message: "Something went wrong. Try again.",
  };
}

/** Friendlier variants for specific write paths, used by server actions. */
export const failureMessages = {
  saveProgress: "Something went wrong saving your progress. Try again.",
  saveProfile: "We could not save your profile. Try again.",
  postReview: "Your review did not go through. Try again.",
  follow: "That follow did not stick. Try again.",
  upload: "That upload failed. Try a smaller image.",
} as const;
