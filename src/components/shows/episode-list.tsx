"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronDown, ListChecks } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { toast } from "@/components/ui/toaster";
import {
  markEpisodeWatchedAction,
  markSeasonWatchedAction,
  markWatchedUpToAction,
  unmarkEpisodeWatchedAction,
} from "@/features/tracking/actions";
import { formatEpisodeCode } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface EpisodeRow {
  id: string;
  number: number;
  seasonNumber: number;
  title: string | null;
  overview: string | null;
  airDate: Date | string | null;
  runtimeMinutes: number | null;
}

export interface SeasonRow {
  id: string;
  number: number;
  title: string | null;
  episodeCount: number;
  episodes: EpisodeRow[];
}

/**
 * Season/episode browser with per-episode tracking.
 *
 * The checkbox uses `useOptimistic` so a click paints instantly — marking an
 * episode is the single most-repeated action in the product and a 200ms round
 * trip on every tick makes binge-logging feel broken. The server is still the
 * authority: a rejected write rolls the tick back and surfaces the reason.
 */
export function EpisodeList({
  showId,
  showSlug,
  seasons,
  watchedIds,
  canTrack,
}: {
  showId: string;
  showSlug: string;
  seasons: SeasonRow[];
  watchedIds: string[];
  canTrack: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [watched, toggleWatched] = useOptimistic(
    new Set(watchedIds),
    (current: Set<string>, change: { id: string; watched: boolean }) => {
      const next = new Set(current);
      if (change.watched) next.add(change.id);
      else next.delete(change.id);
      return next;
    },
  );

  // Open the first season that still has something unwatched — that is where
  // someone returning to a show wants to land.
  const [open, setOpen] = useState<string | null>(() => {
    const target = seasons.find((season) =>
      season.episodes.some((episode) => !watchedIds.includes(episode.id)),
    );
    return (target ?? seasons[0])?.id ?? null;
  });

  function toggleEpisode(episode: EpisodeRow, isWatched: boolean) {
    startTransition(async () => {
      toggleWatched({ id: episode.id, watched: !isWatched });

      const result = isWatched
        ? await unmarkEpisodeWatchedAction(episode.id, showSlug)
        : await markEpisodeWatchedAction(episode.id, showSlug);

      if (!result.ok) {
        toast.error(result.message ?? "Could not save that.");
        router.refresh();
        return;
      }

      const outcome = result.data;
      if (outcome && outcome.xpAwarded > 0) toast.success(`+${outcome.xpAwarded} XP`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {seasons.map((season) => {
        const watchedInSeason = season.episodes.filter((e) => watched.has(e.id)).length;
        const isOpen = open === season.id;
        const seasonComplete =
          season.episodes.length > 0 && watchedInSeason === season.episodes.length;

        return (
          <div key={season.id} className="overflow-hidden rounded-card border border-line">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : season.id)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 bg-surface-raised px-4 py-3 text-left transition-colors hover:bg-surface-overlay"
            >
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-ink-faint transition-transform",
                  isOpen && "rotate-180",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-semibold">
                  {season.number === 0 ? "Specials" : `Season ${season.number}`}
                  {season.title && season.title !== `Season ${season.number}` ? (
                    <span className="ml-2 font-sans font-normal text-ink-faint">
                      {season.title}
                    </span>
                  ) : null}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <ProgressBar
                    value={watchedInSeason}
                    max={season.episodes.length || 1}
                    className="max-w-32"
                    tone={seasonComplete ? "success" : "accent"}
                  />
                  <span className="tnum text-xs text-ink-faint">
                    {watchedInSeason} / {season.episodes.length}
                  </span>
                </div>
              </div>
              {seasonComplete ? <Check className="size-4 shrink-0 text-success" /> : null}
            </button>

            {isOpen ? (
              <div>
                {canTrack && !seasonComplete ? (
                  <div className="border-t border-line px-4 py-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await markSeasonWatchedAction(season.id, showSlug);
                          if (!result.ok) {
                            toast.error(result.message ?? "Could not mark that season.");
                            return;
                          }
                          if (result.data && result.data.xpAwarded > 0) {
                            toast.success(`+${result.data.xpAwarded} XP`);
                          }
                          router.refresh();
                        })
                      }
                    >
                      <ListChecks /> Mark whole season watched
                    </Button>
                  </div>
                ) : null}

                <ul className="divide-y divide-line border-t border-line">
                  {season.episodes.map((episode) => {
                    const isWatched = watched.has(episode.id);
                    return (
                      <li
                        key={episode.id}
                        className={cn(
                          "flex items-start gap-3 px-4 py-2.5 transition-colors",
                          isWatched && "bg-success/5",
                        )}
                      >
                        {canTrack ? (
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={isWatched}
                            aria-label={`${isWatched ? "Unmark" : "Mark"} ${formatEpisodeCode(episode.seasonNumber, episode.number)} watched`}
                            onClick={() => toggleEpisode(episode, isWatched)}
                            className={cn(
                              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                              isWatched
                                ? "border-success bg-success text-ground"
                                : "border-line-strong hover:border-primary",
                            )}
                          >
                            {isWatched ? <Check className="size-3.5" strokeWidth={3} /> : null}
                          </button>
                        ) : (
                          <span className="mt-0.5 size-5 shrink-0" />
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="flex items-baseline gap-2 text-sm">
                            <span className="tnum shrink-0 font-mono text-xs text-ink-faint">
                              {formatEpisodeCode(episode.seasonNumber, episode.number)}
                            </span>
                            <span className={cn("truncate", isWatched ? "text-ink-muted" : "text-ink")}>
                              {episode.title ?? `Episode ${episode.number}`}
                            </span>
                          </p>
                          {episode.overview ? (
                            <p className="mt-0.5 line-clamp-2 text-xs text-ink-faint">
                              {episode.overview}
                            </p>
                          ) : null}
                        </div>

                        {canTrack && !isWatched ? (
                          <button
                            type="button"
                            onClick={() =>
                              startTransition(async () => {
                                const result = await markWatchedUpToAction(
                                  showId,
                                  episode.seasonNumber,
                                  episode.number,
                                  showSlug,
                                );
                                if (!result.ok) {
                                  toast.error(result.message ?? "Could not do that.");
                                  return;
                                }
                                toast.success("Caught up to here.");
                                router.refresh();
                              })
                            }
                            className="shrink-0 self-center text-xs text-ink-faint hover:text-primary"
                          >
                            Up to here
                          </button>
                        ) : null}

                        {episode.runtimeMinutes ? (
                          <span className="tnum shrink-0 self-center text-xs text-ink-faint">
                            {episode.runtimeMinutes}m
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
