import type { Metadata } from "next";
import Link from "next/link";

import { ResetPasswordForm } from "@/app/(auth)/reset-password/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Choose a new password</CardTitle>
        <CardDescription>
          This also signs out every other device, which is the point.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {value ? (
          <ResetPasswordForm token={value} />
        ) : (
          <div className="space-y-3 text-sm text-ink-muted">
            <p>That link is missing its token. Ask for a new one.</p>
            <Link
              href="/forgot-password"
              className="text-primary underline-offset-4 hover:underline"
            >
              Send another reset link
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
