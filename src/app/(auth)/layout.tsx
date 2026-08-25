import Link from "next/link";
import { redirect } from "next/navigation";

import { brand } from "@/config/brand";
import { getOptionalSession } from "@/server/auth/session";

/**
 * Shell for the signed-out auth pages. The session check lives here rather
 * than in each page so a new auth route cannot forget it: someone who is
 * already signed in has no business on a login form.
 */
export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const session = await getOptionalSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center px-5 py-6">
        <Link href="/" className="font-display text-lg font-bold tracking-tight">
          <span aria-hidden>{brand.mascot}</span> {brand.name}
        </Link>
      </header>

      <div className="flex flex-1 items-start justify-center px-5 pb-20 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </main>
  );
}
