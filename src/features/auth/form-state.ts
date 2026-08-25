/**
 * Shared shape for the auth form actions.
 *
 * This lives outside `actions.ts` because a `"use server"` module may only
 * export async functions — exporting the initial-state constant from there
 * fails at build with `invalid-use-server-value`.
 */
export interface AuthFormState {
  /** Form-level message. Absent on the initial render. */
  message?: string;
  /** Per-field messages, keyed by the form field name. */
  fieldErrors?: Record<string, string[]>;
}

export const emptyFormState: AuthFormState = {};
