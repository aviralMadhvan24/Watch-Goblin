import type { Metadata } from "next";
import Link from "next/link";
import { Clapperboard, Flame, Trophy, Tv } from "lucide-react";

import { ContinueWatchingRow } from "@/app/(app)/dashboard/continue-watching";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionHeader, StatRow, StatTile } from "@/components/shared/stat-tile";
import { ActivityFeed } from "@/components/feed/activity-feed";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { copy } from "@/config/brand";
import { formatCompact, formatDuration, formatNumber, pluralize } from "@/lib/format";
import { getLevelProgress } from "@/lib/leveling";
import { requireSession } from "@/server/auth/session";
import { getContinueWatching, getUserStats } from "@/server/queries/library";
import { getFollowingFeed } from "@/server/queries/social";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await requireSession("/dashboard");
  const { user } = session;
  const humor = user.humorEnabled;

  const [continueWatching, stats, feed] = await Promise.all([
    getContinueWatching(user.id),
    getUserStats(user.id),
    getFollowingFeed(user.id, 12),
  ]);

  const level = getLevelProgress(stats?.xpTotal ?? 0);
  const streak = stats?.currentStreak ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Welcome back, {user.displayName}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {streak > 0
              ? `${streak}-day streak. Keep it alive.`
              : humor
                ? copy.streak.broken
                : copy.plain.streak.broken}
          </p>
        </div>
        <Button variant="secondary" size="sm" asChild>
          <Link href="/discover">Find something new</Link>
        </Button>
      </header>

      {/* Level card. XP is the product's core loop, so it leads. */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="text-3xl">
              {stats?.rank?.icon ?? "🍿"}
            </span>
            <div>
              <p className="font-display text-lg font-semibold">
                {stats?.rank?.name ?? "Unranked"}
              </p>
              <p className="text-sm text-ink-muted">
                Level {level.level} · {formatNumber(stats?.xpTotal ?? 0)} XP
              </p>
            </div>
          </div>
          <div className="min-w-48 flex-1 sm:max-w-xs">
            <div className="mb-1.5 flex justify-between text-xs text-ink-faint">
              <span>Level {level.level}</span>
              <span className="tnum">{Math.round(level.progress * 100)}%</span>
            </div>
            <ProgressBar value={level.progress * 100} blocks />
            <p className="mt-1.5 text-xs text-ink-faint">
              {level.isMaxLevel || level.xpForLevel === null ? (
                "Max level. There is nothing left to prove."
              ) : (
                <>
                  {formatNumber(level.xpIntoLevel)} / {formatNumber(level.xpForLevel)} XP to level{" "}
                  {level.level + 1}
                </>
              )}
            </p>
          </div>
        </div>
      </Card>

      <StatRow>
        <StatTile
          label="Episodes"
          value={formatNumber(stats?.episodesWatched ?? 0)}
          icon={<Clapperboard className="size-4" />}
        />
        <StatTile
          label="Watch time"
          value={formatDuration(stats?.minutesWatched ?? 0)}
          icon={<Tv className="size-4" />}
        />
        <StatTile
          label="Completed"
          value={formatNumber(stats?.showsCompleted ?? 0)}
          hint={`${stats?.animeCompleted ?? 0} anime · ${stats?.tvCompleted ?? 0} TV`}
          icon={<Trophy className="size-4" />}
          tone="accent"
        />
        <StatTile
          label="Streak"
          value={streak}
          hint={`Best: ${stats?.longestStreak ?? 0} ${pluralize(stats?.longestStreak ?? 0, "day")}`}
          icon={<Flame className="size-4" />}
          tone={streak > 0 ? "success" : "default"}
        />
      </StatRow>

      <section>
        <SectionHeader
          title="Continue watching"
          action={
            <Link href="/library" className="text-sm text-ink-muted hover:text-primary">
              Full library →
            </Link>
          }
        />
        {continueWatching.length === 0 ? (
          <EmptyState variant="completed" humor={humor} action={{ href: "/discover" }} />
        ) : (
          <ContinueWatchingRow entries={continueWatching} humor={humor} />
        )}
      </section>

      <section>
        <SectionHeader
          title="From people you follow"
          action={
            <Link href="/feed" className="text-sm text-ink-muted hover:text-primary">
              Full feed →
            </Link>
          }
        />
        {feed.length === 0 ? (
          <EmptyState variant="feed" humor={humor} action={{ href: "/people" }} />
        ) : (
          <ActivityFeed items={feed} />
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <QuickStat label="Watching" value={stats?.watching ?? 0} href="/library?status=WATCHING" />
        <QuickStat
          label="Plan to watch"
          value={stats?.planToWatch ?? 0}
          href="/library?status=PLAN_TO_WATCH"
        />
        <QuickStat
          label="Followers"
          value={formatCompact(stats?.followersCount ?? 0)}
          href={`/u/${user.username}`}
        />
      </section>
    </div>
  );
}

function QuickStat({
  label,
  value,
  href,
}: {
  label: string;
  value: string | number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-card border border-line px-4 py-3 transition-colors hover:border-line-strong hover:bg-surface-raised"
    >
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="tnum font-display font-semibold text-ink">{value}</span>
    </Link>
  );
}
