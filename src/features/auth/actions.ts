"use server";

import { redirect } from "next/navigation";

import type { AuthFormState } from "@/features/auth/form-state";
import { isAppError, toUserFacingError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { authService } from "@/server/services/auth.service";

/**
 * Auth server actions.
 *
 * Shape contract with the forms: an action either redirects (success) or
 * returns an `AuthFormState` (failure). It never throws at the client, because
 * a thrown server action surfaces as an opaque digest — useless to the person
 * who just mistyped their password.
 *
 * `redirect()` is deliberately called *outside* the try/catch: it signals by
 * throwing a `NEXT_REDIRECT` control-flow error, and catching that would turn
 * every successful login into "something went wrong".
 */

export async function registerAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    await authService.register({
      email: formData.get("email"),
      username: formData.get("username"),
      displayName: emptyToUndefined(formData.get("displayName")),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });
  } catch (error) {
    return toFormState(error, "register");
  }

  redirect("/dashboard");
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    await authService.login({
      email: formData.get("email"),
      password: formData.get("password"),
    });
  } catch (error) {
    return toFormState(error, "login");
  }

  redirect(safeNext(formData.get("next")));
}

export async function requestPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    await authService.requestPasswordReset({ email: formData.get("email") });
  } catch (error) {
    return toFormState(error, "requestPasswordReset");
  }

  // Deliberately the same message whether or not the address has an account —
  // the service is careful not to leak that, and the UI must not undo it.
  return {
    message: "If that email has an account, a reset link is on its way.",
  };
}

export async function confirmPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    await authService.confirmPasswordReset({
      token: formData.get("token"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });
  } catch (error) {
    return toFormState(error, "confirmPasswordReset");
  }

  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await authService.logout();
  redirect("/");
}

/**
 * `AppError`s carry copy that was written for the user, so they pass through.
 * Anything else is a bug or an outage: it gets logged with its detail and
 * collapsed into a generic message, so a Prisma constraint name or a stack
 * frame never reaches the browser.
 */
function toFormState(error: unknown, action: string): AuthFormState {
  if (!isAppError(error)) {
    logger.error("Unhandled auth action failure", error, { action });
  }
  const { message, fieldErrors } = toUserFacingError(error);
  return { message, ...(fieldErrors ? { fieldErrors } : {}) };
}

/** A blank optional field is "not provided", not "the empty string". */
function emptyToUndefined(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return undefined;
  return value.trim() === "" ? undefined : value;
}

/**
 * `?next=` comes from the URL, so it is attacker-controlled. Only same-site
 * absolute paths are honoured — anything else (a full URL, a protocol-relative
 * `//evil.example`) would turn our login page into an open redirect.
 */
function safeNext(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}
