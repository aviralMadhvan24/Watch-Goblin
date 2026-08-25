"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { loginAction } from "@/features/auth/actions";
import { emptyFormState } from "@/features/auth/form-state";

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(loginAction, emptyFormState);

  const fieldErrors = state.fieldErrors ?? {};
  const showBanner = Boolean(state.message) && Object.keys(fieldErrors).length === 0;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {/* Carried through the POST so the action can honour it without re-reading the URL. */}
      {next ? <input type="hidden" name="next" value={next} /> : null}

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

      <Field label="Password" htmlFor="password" error={first(fieldErrors.password)} required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(fieldErrors.password)}
        />
      </Field>

      <div className="text-right">
        <Link
          href="/forgot-password"
          className="text-xs text-ink-muted underline-offset-4 hover:text-primary hover:underline"
        >
          Forgot your password?
        </Link>
      </div>

      <SubmitButton>Log in</SubmitButton>

      <p className="text-center text-sm text-ink-muted">
        No account yet?{" "}
        <Link href="/register" className="text-primary underline-offset-4 hover:underline">
          Make one
        </Link>
      </p>
    </form>
  );
}

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
