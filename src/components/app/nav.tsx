"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Flame, LayoutDashboard, Library, Menu, Trophy, X } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

/**
 * Primary navigation.
 *
 * A client component only because it needs the current path for the active
 * state and local state for the mobile sheet — the session it renders is
 * resolved on the server and passed down, so no auth check happens in the
 * browser.
 */

export interface NavUser {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  accentColor: string;
  level: number;
}

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, authOnly: true },
  { href: "/discover", label: "Discover", icon: Compass, authOnly: false },
  { href: "/library", label: "Library", icon: Library, authOnly: true },
  { href: "/feed", label: "Feed", icon: Flame, authOnly: true },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy, authOnly: false },
] as const;

export function Nav({ user }: { user: NavUser | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = LINKS.filter((link) => user || !link.authOnly);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ground/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-5 py-3">
        <Link
          href={user ? "/dashboard" : "/"}
          className="mr-2 shrink-0 font-display text-base font-bold tracking-tight"
        >
          <span aria-hidden>{brand.mascot}</span>{" "}
          <span className="hidden sm:inline">{brand.name}</span>
        </Link>

        <nav className="hidden items-center gap-0.5 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                isActive(link.href)
                  ? "bg-surface-raised text-ink"
                  : "text-ink-muted hover:bg-surface-raised hover:text-ink",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <Link
              href={`/u/${user.username}`}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-surface-raised"
            >
              <Avatar
                src={user.avatarUrl}
                name={user.displayName}
                accentColor={user.accentColor}
                size="sm"
              />
              <span className="hidden text-sm font-medium text-ink sm:inline">
                {user.displayName}
              </span>
              <span className="tnum rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                {user.level}
              </span>
            </Link>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/login">Log in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/register">Sign up</Link>
              </Button>
            </>
          )}

          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>

      {open ? (
        <nav className="border-t border-line px-5 py-2 md:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-sm font-medium",
                isActive(link.href) ? "text-ink" : "text-ink-muted",
              )}
            >
              <link.icon className="size-4" />
              {link.label}
            </Link>
          ))}
          {user ? (
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-sm font-medium text-ink-muted"
            >
              Settings
            </Link>
          ) : null}
        </nav>
      ) : null}
    </header>
  );
}
