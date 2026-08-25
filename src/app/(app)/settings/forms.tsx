"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input, Label, Textarea } from "@/components/ui/input";
import { idle, type ActionResult } from "@/features/shared/action-result";
import { changePasswordAction, updateProfileAction } from "@/features/profile/actions";
import type { Visibility } from "@/generated/prisma/enums";
import { logoutAction } from "@/features/auth/actions";

const VISIBILITY_OPTIONS: { value: Visibility; label: string; hint: string }[] = [
  { value: "PUBLIC", label: "Public", hint: "Anyone can see it." },
  { value: "FOLLOWERS", label: "Followers", hint: "Only people you approve of." },
  { value: "PRIVATE", label: "Private", hint: "Just you." },
];

const ACCENTS = ["#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444"];

export function ProfileForm({
  initial,
}: {
  initial: {
    displayName: string;
    bio: string | null;
    avatarUrl: string | null;
    accentColor: string;
    visibility: Visibility;
    activityVisibility: Visibility;
    humorEnabled: boolean;
  };
}) {
  const [state, formAction] = useActionState(updateProfileAction, idle);

  return (
    <form action={formAction} className="space-y-4">
      <Banner state={state} />

      <Field
        label="Display name"
        htmlFor="displayName"
        error={state.fieldErrors?.displayName?.[0]}
        required
      >
        <Input
          id="displayName"
          name="displayName"
          defaultValue={initial.displayName}
          maxLength={40}
          required
        />
      </Field>

      <Field
        label="Bio"
        htmlFor="bio"
        hint="280 characters. Make them count, or do not."
        error={state.fieldErrors?.bio?.[0]}
      >
        <Textarea id="bio" name="bio" defaultValue={initial.bio ?? ""} maxLength={280} />
      </Field>

      <Field
        label="Avatar URL"
        htmlFor="avatarUrl"
        hint="Uploads are not wired up yet — paste a link for now."
        error={state.fieldErrors?.avatarUrl?.[0]}
      >
        <Input
          id="avatarUrl"
          name="avatarUrl"
          type="url"
          defaultValue={initial.avatarUrl ?? ""}
          placeholder="https://…"
        />
      </Field>

      <fieldset>
        <Label>Accent colour</Label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {ACCENTS.map((color) => (
            <label key={color} className="cursor-pointer">
              <input
                type="radio"
                name="accentColor"
                value={color}
                defaultChecked={initial.accentColor.toLowerCase() === color}
                className="peer sr-only"
              />
              <span
                className="block size-8 rounded-full border-2 border-transparent transition-all peer-checked:border-ink peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40"
                style={{ backgroundColor: color }}
              />
              <span className="sr-only">{color}</span>
            </label>
          ))}
        </div>
        {state.fieldErrors?.accentColor?.[0] ? (
          <p className="mt-1 text-xs text-danger">{state.fieldErrors.accentColor[0]}</p>
        ) : null}
      </fieldset>

      <VisibilitySelect
        name="visibility"
        label="Who can see your profile"
        value={initial.visibility}
      />
      <VisibilitySelect
        name="activityVisibility"
        label="Who can see your watch activity"
        value={initial.activityVisibility}
      />

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          name="humorEnabled"
          defaultChecked={initial.humorEnabled}
          className="mt-0.5 size-4 rounded border-line-strong bg-surface accent-primary"
        />
        <span>
          <span className="font-medium text-ink">Keep the jokes</span>
          <span className="block text-xs text-ink-faint">
            Turn this off for plain, unfunny copy everywhere.
          </span>
        </span>
      </label>

      <div className="border-t border-line pt-4">
        <SubmitButton>Save changes</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Sign-out lives in its own form: a `<form>` inside another `<form>` is invalid
 * HTML, and browsers resolve it by dropping the inner one entirely.
 */
export function LogoutForm() {
  return (
    <form action={logoutAction}>
      <Button type="submit" variant="secondary" size="sm">
        Log out
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, idle);

  return (
    <form action={formAction} className="space-y-4">
      <Banner state={state} />

      <Field
        label="Current password"
        htmlFor="currentPassword"
        error={state.fieldErrors?.currentPassword?.[0]}
        required
      >
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <Field
        label="New password"
        htmlFor="newPassword"
        hint="At least 10 characters."
        error={state.fieldErrors?.newPassword?.[0]}
        required
      >
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>

      <Field
        label="Confirm new password"
        htmlFor="confirmPassword"
        error={state.fieldErrors?.confirmPassword?.[0]}
        required
      >
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>

      <SubmitButton>Change password</SubmitButton>
    </form>
  );
}

function VisibilitySelect({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: Visibility;
}) {
  return (
    <fieldset>
      <Label>{label}</Label>
      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
        {VISIBILITY_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="cursor-pointer rounded-xl border border-line bg-surface-raised px-3 py-2 transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-primary/10"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={value === option.value}
              className="sr-only"
            />
            <span className="block text-sm font-medium text-ink">{option.label}</span>
            <span className="block text-xs text-ink-faint">{option.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Shared success/failure banner. Success only appears after a real submit. */
function Banner({ state }: { state: ActionResult }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={
        state.ok
          ? "rounded-xl border border-success/40 bg-success/10 px-3.5 py-2.5 text-sm text-success"
          : "rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
      }
    >
      {state.message}
    </p>
  );
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {children}
    </Button>
  );
}
