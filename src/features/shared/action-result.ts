import { toUserFacingError } from "@/lib/errors";

/**
 * The contract every server action in the app returns.
 *
 * Actions never throw at the client: a thrown server action reaches the browser
 * as an opaque digest, which is useless to someone who just hit a rate limit or
 * mistyped a rating. `ok: false` plus a written message is always more useful.
 *
 * This module has no `"use server"` directive on purpose — such a file may only
 * export async functions, so the shared types and helpers have to live outside
 * the action modules that use them.
 */
export interface ActionResult<T = undefined> {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  data?: T;
}

export const idle: ActionResult = { ok: true };

export function ok<T>(data?: T): ActionResult<T> {
  return { ok: true, ...(data === undefined ? {} : { data }) };
}

/** Converts a thrown value into a failed result safe to send to the browser. */
export function fail(error: unknown): ActionResult<never> {
  const { message, fieldErrors } = toUserFacingError(error);
  return { ok: false, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

/** Reads a required string field, so actions do not repeat the same guard. */
export function requiredString(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing form field: ${key}`);
  }
  return value;
}

export function optionalString(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value;
}
