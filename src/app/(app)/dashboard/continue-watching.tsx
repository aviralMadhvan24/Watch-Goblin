"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { useTransition } from "react";

import { Poster } from "@/components/shows/poster";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { toast } from "@/components/ui/toaster";
import { copy } from "@/config/brand";
import { continueWatchingAction } from "@/features/tracking/actions";
import { formatEpisodeCode } from "@/lib/format";
import type { ContinueWatchingEntry } from "@/server/queries/library";

/**
 * The dashboard's "pick up where you left off" row.
 *
 * Marking the next episode happens inline: the whole point of this row is that
 * logging an episode should not require visiting the show page first.
 */
export function ContinueWatchingRow({
  entries,
  humor,
}: {
  entries: ContinueWatchingEntry[];
  humor: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => (
        <ContinueCard key={entry.id} entry={entry} humor={humor} />
      ))}
    </div>
  );
}

function ContinueCard({ entry, humor }: { entry: ContinueWatchingEntry; humor: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = entry.nextEpisode;

  return (
    <Card className="flex gap-3 p-3">
      <Link href={`/shows/${entry.show.slug}`} className="w-16 shrink-0">
        <Poster src={entry.show.posterUrl} title={entry.show.title} />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={`/shows/${entry.show.slug}`}
          className="truncate font-display text-sm font-semibold hover:text-primary"
        >
          {entry.show.title}
        </Link>

        {next ? (
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            <span className="tnum font-mono">
              {formatEpisodeCode(next.seasonNumber, next.number)}
            </span>
            {next.title ? ` · ${next.title}` : null}
          </p>
        ) : null}

        <div className="mt-2 space-y-1">
          <ProgressBar value={entry.progress} />
          <p className="tnum text-xs text-ink-faint">
            {entry.episodesWatched} / {entry.show.totalEpisodes}
          </p>
        </div>

        <Button
          size="sm"
          className="mt-auto w-full"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await continueWatchingAction(entry.show.id, entry.show.slug);
              if (!result.ok) {
                toast.error(result.message ?? "Could not mark that.");
                return;
              }
              const outcome = result.data;
              if (!outcome) {
                toast.success("Nothing left to watch here.");
              } else if (outcome.showCompleted) {
                toast.success(
                  humor ? copy.celebrate.showCompleted : copy.plain.celebrate.showCompleted,
                );
              } else if (outcome.xpAwarded > 0) {
                toast.success(`+${outcome.xpAwarded} XP`);
              }
              router.refresh();
            })
          }
        >
          <Play /> Mark watched
        </Button>
      </div>
    </Card>
  );
}
