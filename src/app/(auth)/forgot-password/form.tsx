"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestPasswordResetAction } from "@/features/auth/actions";
import { emptyFormState } from "@/features/auth/form-state";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, emptyFormState);

  // The action returns the same confirmation whether or not the account exists,
  // so a delivered message is never proof that an address is registered.
  const sent = Boolean(state.message) && !state.fieldErrors;

  if (sent) {
    return (
      <p role="status" className="rounded-xl border border-line bg-surface-raised px-3.5 py-3 text-sm text-ink-muted">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email?.[0]} required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(state.fieldErrors?.email)}
        />
      </Field>
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" loading={pending} className="w-full">
      Send reset link
    </Button>
  );
}
