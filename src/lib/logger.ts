/**
 * Minimal structured logger.
 *
 * Deliberately not a dependency: one JSON line per event on stdout is exactly
 * what a container platform wants, and it keeps the "log the real error, show
 * the user a friendly one" rule cheap enough that nobody skips it.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const minLevel: Level =
  process.env.NODE_ENV === "production"
    ? "info"
    : process.env.NODE_ENV === "test"
      ? "error"
      : "debug";

/** Never let a secret ride along in a log context. */
const REDACTED_KEYS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "passwordHash",
  "token",
  "tokenHash",
  "sessionToken",
  "authorization",
  "cookie",
  "secret",
]);

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key) ? "[redacted]" : sanitize(val, depth + 1);
  }
  return out;
}

interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.cause ? { cause: serializeError(error.cause) } : {}),
    };
  }
  return { message: String(error) };
}

function write(level: Level, message: string, context?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? (sanitize(context) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
  error: (message: string, error?: unknown, context?: Record<string, unknown>) =>
    write("error", message, { ...context, error: error ? serializeError(error) : undefined }),
};
