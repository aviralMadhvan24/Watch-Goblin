"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { registerAction } from "@/features/auth/actions";
import { emptyFormState } from "@/features/auth/form-state";

export function RegisterForm() {
  const [state, formAction] = useActionState(registerAction, emptyFormState);

  // Field-level messages win; the form-level banner only carries what could not
  // be attached to a single input (a conflict, a rate limit, an outage).
  const fieldErrors = state.fieldErrors ?? {};
  const showBanner = Boolean(state.message) && Object.keys(fieldErrors).length === 0;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {showBanner ? (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}

      <Field label="Email" htmlFor="email" error={first(fieldErrors.email)} required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(fieldErrors.email)}
        />
      </Field>

      <Field
        label="Username"
        htmlFor="username"
        hint="Letters, numbers and underscores. This is your profile URL."
        error={first(fieldErrors.username)}
        required
      >
        <Input
          id="username"
          name="username"
          autoComplete="username"
          required
          aria-invalid={Boolean(fieldErrors.username)}
        />
      </Field>

      <Field
        label="Display name"
        htmlFor="displayName"
        hint="Optional. Defaults to your username."
        error={first(fieldErrors.displayName)}
      >
        <Input
          id="displayName"
          name="displayName"
          autoComplete="nickname"
          aria-invalid={Boolean(fieldErrors.displayName)}
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        hint="At least 10 characters."
        error={first(fieldErrors.password)}
        required
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(fieldErrors.password)}
        />
      </Field>

      <Field
        label="Confirm password"
        htmlFor="confirmPassword"
        error={first(fieldErrors.confirmPassword)}
        required
      >
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(fieldErrors.confirmPassword)}
        />
      </Field>

      <SubmitButton>Make an account</SubmitButton>

      <p className="text-center text-sm text-ink-muted">
        Already have one?{" "}
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}

/**
 * Split out because `useFormStatus` only reports the pending state of the form
 * it is rendered *inside* — reading it in the parent would always return false.
 */
function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" loading={pending} className="w-full">
      {children}
    </Button>
  );
}

function first(messages?: string[]) {
  return messages?.[0];
}
