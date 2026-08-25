import type { Metadata } from "next";

import { LogoutForm, PasswordForm, ProfileForm } from "@/app/(app)/settings/forms";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/server/auth/session";
import { profileService } from "@/server/services/profile.service";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireSession("/settings");
  const profile = await profileService.getSettings(session.user.id);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-5 py-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">@{session.user.username}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you look to everyone else.</CardDescription>
        </CardHeader>
        <div className="p-5 pt-0">
          <ProfileForm initial={profile} />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Changing this signs you out everywhere else, which is the point.
          </CardDescription>
        </CardHeader>
        <div className="p-5 pt-0">
          <PasswordForm />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>Sign out on this device.</CardDescription>
        </CardHeader>
        <div className="p-5 pt-0">
          <LogoutForm />
        </div>
      </Card>
    </div>
  );
}
