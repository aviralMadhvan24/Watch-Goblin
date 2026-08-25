import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";

import { ActivityFeed } from "@/components/feed/activity-feed";
import { SimpleEmpty } from "@/components/shared/empty-state";
import { SectionHeader, StatRow, StatTile } from "@/components/shared/stat-tile";
import { Poster } from "@/components/shows/poster";
import { FollowButton } from "@/components/social/follow-button";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatDuration, formatNumber, formatRelativeTime } from "@/lib/format";
import { getLevelProgress } from "@/lib/leveling";
import { getOptionalSession } from "@/server/auth/session";
import { getProfile, getRecentlyWatched, getUserActivity } from "@/server/queries/social";

export async function generateMetadata({
  params,
}: PageProps<"/u/[username]">): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username}` };
}

export default async function ProfilePage({ params }: PageProps<"/u/[username]">) {
  const { username } = await params;
  const session = await getOptionalSession();

  const profile = await getProfile(username, session?.user.id ?? null);
  if (!profile) notFound();

  const stats = profile.stats;
  const level = getLevelProgress(stats?.xpTotal ?? 0);

  // Only fetched once visibility has already passed — see `getProfile`.
  const [activity, recent] = profile.activityVisible
    ? await Promise.all([getUserActivity(profile.id, 20), getRecentlyWatched(profile.id, 12)])
    : [[], []];

  return (
    <div>
      <div
        className="h-28 border-b border-line sm:h-40"
        style={{
          background: `linear-gradient(135deg, ${profile.accentColor}33, transparent 70%)`,
        }}
      />

      <div className="mx-auto w-full max-w-4xl px-5">
        <header className="-mt-12 flex flex-wrap items-end gap-4 sm:-mt-16">
          <Avatar
            src={profile.avatarUrl}
            name={profile.displayName}
            accentColor={profile.accentColor}
            size="xl"
            className="border-4 border-ground"
          />

          <div className="min-w-0 flex-1 pb-1">
            <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
              {profile.displayName}
            </h1>
            <p className="text-sm text-ink-faint">@{profile.username}</p>
          </div>

          <div className="pb-1">
            {profile.isSelf ? (
              <Button variant="secondary" size="sm" asChild>
                <Link href="/settings">Edit profile</Link>
              </Button>
            ) : session ? (
              <FollowButton
                username={profile.username}
                initialFollowing={profile.isFollowing}
                size="sm"
              />
            ) : null}
          </div>
        </header>

        {profile.bio ? (
          <p className="mt-4 max-w-xl text-sm text-ink-muted text-pretty">{profile.bio}</p>
        ) : null}

        <p className="mt-2 text-xs text-ink-faint">
          Joined {formatRelativeTime(profile.joinedAt)} ·{" "}
          <Link href={`/u/${profile.username}/followers`} className="hover:text-primary">
            <span className="tnum">{formatNumber(stats?.followersCount ?? 0)}</span> followers
          </Link>{" "}
          ·{" "}
          <Link href={`/u/${profile.username}/following`} className="hover:text-primary">
            <span className="tnum">{formatNumber(stats?.followingCount ?? 0)}</span> following
          </Link>
        </p>

        {!profile.visible ? (
          <div className="mt-8">
            <SimpleEmpty
              title="This profile is private"
              body="Only people they follow can see what they watch."
            />
          </div>
        ) : (
          <div className="mt-8 space-y-10 pb-10">
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span aria-hidden className="text-3xl">
                    {stats?.rank?.icon ?? "🍿"}
                  </span>
                  <div>
                    <p className="font-display font-semibold">{stats?.rank?.name ?? "Unranked"}</p>
                    <p className="text-sm text-ink-muted">
                      Level {level.level} · {formatNumber(stats?.xpTotal ?? 0)} XP
                    </p>
                  </div>
                </div>
                <div className="min-w-48 flex-1 sm:max-w-xs">
                  <ProgressBar value={level.progress * 100} blocks />
                </div>
              </div>
            </Card>

            <StatRow>
              <StatTile label="Episodes" value={formatNumber(stats?.episodesWatched ?? 0)} />
              <StatTile label="Watch time" value={formatDuration(stats?.minutesWatched ?? 0)} />
              <StatTile
                label="Completed"
                value={formatNumber(stats?.showsCompleted ?? 0)}
                hint={`${stats?.animeCompleted ?? 0} anime · ${stats?.tvCompleted ?? 0} TV`}
                tone="accent"
              />
              <StatTile
                label="Streak"
                value={stats?.currentStreak ?? 0}
                hint={`Best: ${stats?.longestStreak ?? 0}`}
                tone={(stats?.currentStreak ?? 0) > 0 ? "success" : "default"}
              />
            </StatRow>

            {profile.favoriteShows.length > 0 ? (
              <section>
                <SectionHeader title="Favourites" />
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                  {profile.favoriteShows.map((show) => (
                    <Link key={show.slug} href={`/shows/${show.slug}`} className="group">
                      <Poster
                        src={show.posterUrl}
                        title={show.title}
                        className="transition-transform group-hover:scale-[1.03]"
                      />
                      <p className="mt-1.5 truncate text-xs text-ink-muted group-hover:text-primary">
                        {show.title}
                      </p>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            {!profile.activityVisible ? (
              <div className="flex items-center gap-2 rounded-card border border-dashed border-line px-4 py-6 text-sm text-ink-muted">
                <Lock className="size-4" />
                Their watch activity is hidden.
              </div>
            ) : (
              <>
                {recent.length > 0 ? (
                  <section>
                    <SectionHeader title="Recently watched" />
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                      {recent.map((item) => (
                        <Link
                          key={item.episodeId}
                          href={`/shows/${item.show.slug}`}
                          className="group"
                        >
                          <Poster
                            src={item.show.posterUrl}
                            title={item.show.title}
                            className="transition-transform group-hover:scale-[1.03]"
                          />
                          <p className="mt-1.5 truncate text-xs text-ink-muted group-hover:text-primary">
                            {item.show.title}
                          </p>
                          <p className="tnum truncate font-mono text-[11px] text-ink-faint">
                            S{item.seasonNumber}E{item.episodeNumber}
                          </p>
                        </Link>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section>
                  <SectionHeader title="Activity" />
                  {activity.length === 0 ? (
                    <SimpleEmpty title="Nothing has happened" body="Suspiciously well-adjusted." />
                  ) : (
                    <ActivityFeed items={activity} />
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
