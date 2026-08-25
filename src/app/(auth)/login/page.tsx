import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Log in",
  description: "Get back to your watch history.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Set by `requireSession` when it bounces someone off a protected page.
  const { next } = await searchParams;
  const returnTo = typeof next === "string" ? next : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Log in</CardTitle>
        <CardDescription>Your backlog is exactly where you left it.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={returnTo} />
      </CardContent>
    </Card>
  );
}
