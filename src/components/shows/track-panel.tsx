"use client";

import { useRouter } from "next/navigation";
import { Check, Play, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";

import { STATUS_LABELS, STATUS_ORDER } from "@/components/shared/status";
import { StarRating } from "@/components/shows/star-rating";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { copy } from "@/config/brand";
import {
  addToLibraryAction,
  continueWatchingAction,
  rateShowAction,
  removeFromLibraryAction,
  setStatusAction,
} from "@/features/tracking/actions";
import type { WatchStatus } from "@/generated/prisma/enums";
import { formatEpisodeCode } from "@/lib/format";
import type { TrackingResult } from "@/features/tracking/actions";

/**
 * The show page's tracking controls.
 *
 * Every button routes through a server action and then `router.refresh()`, so
 * the episode list, progress bar and stats all re-render from the server's
 * derived state. Nothing here computes progress locally — that is exactly the
 * kind of number the server owns.
 */
export function TrackPanel({
  showId,
  showSlug,
  totalEpisodes,
  humor,
  initial,
}: {
  showId: string;
  showSlug: string;
  totalEpisodes: number;
  humor: boolean;
  initial: {
    status: WatchStatus;
    rating: number | null;
    episodesWatched: number;
    currentSeasonNumber: number;
    currentEpisodeNumber: number;
  } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rating, setRating] = useState<number | null>(initial?.rating ?? null);

  /** Surfaces XP, level-ups and achievements that the server reports back. */
  function celebrate(result: TrackingResult) {
    if (!result.ok) {
      toast.error(result.message ?? "That did not work.");
      return false;
    }

    const outcome = result.data;
    if (outcome) {
      if (outcome.showCompleted) {
        toast.success(humor ? copy.celebrate.showCompleted : copy.plain.celebrate.showCompleted);
      } else if (outcome.xpAwarded > 0) {
        toast.success(`+${outcome.xpAwarded} XP`);
      }
      if (outcome.leveledUp) {
        toast.success(
          `${humor ? copy.celebrate.levelUp : copy.plain.celebrate.levelUp} (level ${outcome.level})`,
        );
      }
      for (const achievement of outcome.achievements) {
        toast.success(`${achievement.icon} ${achievement.name}`, {
          description: humor ? copy.celebrate.achievement : copy.plain.celebrate.achievement,
        });
      }
    }

    router.refresh();
    return true;
  }

  function run(fn: () => Promise<TrackingResult>) {
    startTransition(async () => {
      celebrate(await fn());
    });
  }

  if (!initial) {
    return (
      <Card className="p-4">
        <p className="text-sm text-ink-muted">Not in your library yet.</p>
        <div className="mt-3 flex flex-col gap-2">
          <Button
            loading={pending}
            onClick={() => run(() => addToLibraryAction(showId, "WATCHING", showSlug))}
          >
            <Play /> Start watching
          </Button>
          <Button
            variant="secondary"
            loading={pending}
            onClick={() => run(() => addToLibraryAction(showId, "PLAN_TO_WATCH", showSlug))}
          >
            <Plus /> Plan to watch
          </Button>
        </div>
      </Card>
    );
  }

  const complete = totalEpisodes > 0 && initial.episodesWatched >= totalEpisodes;

  return (
    <Card className="space-y-4 p-4">
      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-ink-faint">
          Status
        </label>
        <Select
          value={initial.status}
          onValueChange={(value) =>
            run(() => setStatusAction(showId, value as WatchStatus, showSlug))
          }
        >
          <SelectTrigger className="mt-1.5 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_ORDER.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-ink-faint">
          Your rating
        </label>
        <div className="mt-1.5 flex items-center gap-3">
          <StarRating
            value={rating}
            onChange={(next) => {
              setRating(next);
              startTransition(async () => {
                const result = await rateShowAction(showId, next, showSlug);
                if (!result.ok) {
                  // Put the old value back rather than leaving the UI claiming
                  // a rating the server rejected.
                  setRating(initial.rating);
                  toast.error(result.message ?? "Could not save that rating.");
                  return;
                }
                router.refresh();
              });
            }}
          />
          <span className="tnum text-sm text-ink-muted">
            {rating ? rating.toFixed(1) : "—"}
          </span>
        </div>
      </div>

      <div className="space-y-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-muted">Progress</span>
          <span className="tnum text-ink">
            {initial.episodesWatched} / {totalEpisodes || "?"}
          </span>
        </div>
        {initial.currentEpisodeNumber > 0 ? (
          <div className="flex justify-between">
            <span className="text-ink-muted">Up to</span>
            <span className="tnum font-mono text-xs text-ink">
              {formatEpisodeCode(initial.currentSeasonNumber, initial.currentEpisodeNumber)}
            </span>
          </div>
        ) : null}
      </div>

      {complete ? (
        <p className="flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
          <Check className="size-4" /> Every episode watched.
        </p>
      ) : (
        <Button
          className="w-full"
          loading={pending}
          onClick={() => run(() => continueWatchingAction(showId, showSlug))}
        >
          <Play /> Watch next episode
        </Button>
      )}

      <Button
        variant="danger"
        size="sm"
        className="w-full"
        loading={pending}
        onClick={() => {
          startTransition(async () => {
            const result = await removeFromLibraryAction(showId, showSlug);
            if (!result.ok) {
              toast.error(result.message ?? "Could not remove that.");
              return;
            }
            toast.success("Removed from your library.");
            router.refresh();
          });
        }}
      >
        <Trash2 /> Remove from library
      </Button>
    </Card>
  );
}
