import type { Metadata } from "next";
import Link from "next/link";

import { SimpleEmpty } from "@/components/shared/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { formatDuration, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getOptionalSession } from "@/server/auth/session";
import {
  getLeaderboard,
  isLeaderboardMetric,
  LEADERBOARD_METRICS,
  type LeaderboardMetric,
} from "@/server/queries/social";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Someone has to be last.",
};

const MEDALS = ["🥇", "🥈", "🥉"];

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Minutes are stored, hours are read — every other metric is a plain count. */
function renderValue(metric: LeaderboardMetric, value: number): string {
  if (metric === "minutesWatched") return formatDuration(value);
  return formatNumber(value);
}

export default async function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  const params = await searchParams;
  const raw = one(params.metric);
  const metric: LeaderboardMetric = raw && isLeaderboardMetric(raw) ? raw : "xpTotal";

  const [rows, session] = await Promise.all([getLeaderboard(metric, 50), getOptionalSession()]);
  const viewerId = session?.user.id ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight">Leaderboard</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Rankings for an achievement that does not exist. Someone has to be last.
        </p>
      </header>

      <nav className="mb-5 flex flex-wrap gap-1.5" aria-label="Leaderboard metric">
        {(Object.keys(LEADERBOARD_METRICS) as LeaderboardMetric[]).map((key) => (
          <Link
            key={key}
            href={key === "xpTotal" ? "/leaderboard" : `/leaderboard?metric=${key}`}
            aria-current={metric === key ? "page" : undefined}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              metric === key
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-line bg-surface-raised text-ink-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {LEADERBOARD_METRICS[key].label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <SimpleEmpty title="Nobody has done anything yet" body="The bar is on the floor." />
      ) : (
        <Card className="divide-y divide-line">
          {rows.map((row) => {
            const isViewer = row.userId === viewerId;
            return (
              <div
                key={row.userId}
                className={cn(
                  "flex items-center gap-3 px-4 py-3",
                  isViewer && "bg-primary/5",
                )}
              >
                <span
                  className={cn(
                    "tnum w-8 shrink-0 text-center font-display font-bold",
                    row.position <= 3 ? "text-lg" : "text-sm text-ink-faint",
                  )}
                >
                  {row.position <= 3 ? MEDALS[row.position - 1] : row.position}
                </span>

                <Link href={`/u/${row.username}`} className="shrink-0">
                  <Avatar
                    src={row.avatarUrl}
                    name={row.displayName}
                    accentColor={row.accentColor}
                    size="sm"
                  />
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    href={`/u/${row.username}`}
                    className="block truncate text-sm font-medium text-ink hover:text-primary"
                  >
                    {row.displayName}
                    {isViewer ? (
                      <span className="ml-1.5 text-xs text-primary">(you)</span>
                    ) : null}
                  </Link>
                  <p className="truncate text-xs text-ink-faint">
                    {row.rankIcon ? <span aria-hidden>{row.rankIcon} </span> : null}
                    {row.rankName ?? "Unranked"} · Level {row.level}
                  </p>
                </div>

                <span className="tnum shrink-0 font-display text-sm font-semibold text-ink">
                  {renderValue(metric, row.value)}
                </span>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
