import Link from "next/link";

import { Nav } from "@/components/app/nav";
import { brand } from "@/config/brand";
import { getOptionalSession } from "@/server/auth/session";

/**
 * Shell for every in-product page.
 *
 * Deliberately does NOT require a session: Discover, show pages, profiles and
 * the leaderboard are all readable signed-out, and the nav adapts. Pages that
 * genuinely need a user call `requireSession` themselves.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getOptionalSession();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Nav
        user={
          session
            ? {
                username: session.user.username,
                displayName: session.user.displayName,
                avatarUrl: session.user.avatarUrl,
                accentColor: session.user.accentColor,
                level: session.user.level,
              }
            : null
        }
      />

      <main className="flex-1">{children}</main>

      <footer className="mt-12 border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-6 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <span>
            {brand.name} — {brand.tagline}
          </span>
          <nav className="flex gap-4">
            <Link href="/discover" className="hover:text-ink-muted">
              Discover
            </Link>
            <Link href="/leaderboard" className="hover:text-ink-muted">
              Leaderboard
            </Link>
            {session ? (
              <Link href="/settings" className="hover:text-ink-muted">
                Settings
              </Link>
            ) : null}
          </nav>
        </div>
      </footer>
    </div>
  );
}
