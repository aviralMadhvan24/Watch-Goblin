"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { confirmPasswordResetAction } from "@/features/auth/actions";
import { emptyFormState } from "@/features/auth/form-state";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(confirmPasswordResetAction, emptyFormState);
  const fieldErrors = state.fieldErrors ?? {};
  const showBanner = Boolean(state.message) && Object.keys(fieldErrors).length === 0;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />

      {showBanner ? (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}

      <Field
        label="New password"
        htmlFor="password"
        hint="At least 10 characters."
        error={fieldErrors.password?.[0]}
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
        label="Confirm new password"
        htmlFor="confirmPassword"
        error={fieldErrors.confirmPassword?.[0]}
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

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" loading={pending} className="w-full">
      Set new password
    </Button>
  );
}
