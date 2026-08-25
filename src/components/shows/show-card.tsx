import Link from "next/link";
import { Star, Users } from "lucide-react";

import { Poster } from "@/components/shows/poster";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { ShowCardData } from "@/server/queries/shows";
import { formatCompact, formatYear } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The catalogue tile. Used by Discover, search results, profile shelves and the
 * library grid, so progress is optional: the same tile shows a show you have
 * never seen and one you are 40 episodes into.
 */
export function ShowCard({
  show,
  progress,
  footer,
  className,
}: {
  show: ShowCardData | {
    slug: string;
    title: string;
    posterUrl: string | null;
    type?: string;
    firstAirDate?: Date | null;
    totalEpisodes?: number;
    averageRating?: number | null;
    memberCount?: number;
  };
  /** 0–100. Renders a progress bar under the poster when given. */
  progress?: number;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={`/shows/${show.slug}`}
      className={cn(
        "group flex flex-col gap-2 rounded-poster outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        className,
      )}
    >
      <div className="relative">
        <Poster
          src={show.posterUrl}
          title={show.title}
          className="transition-transform duration-200 group-hover:scale-[1.02] group-hover:border-line-strong"
        />
        {show.type ? (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-ground/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted backdrop-blur">
            {show.type === "ANIME" ? "Anime" : "TV"}
          </span>
        ) : null}
      </div>

      {progress !== undefined ? <ProgressBar value={progress} /> : null}

      <div className="min-w-0">
        <p className="truncate font-display text-sm font-semibold text-ink group-hover:text-primary">
          {show.title}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-faint">
          {show.firstAirDate ? <span className="tnum">{formatYear(show.firstAirDate)}</span> : null}
          {show.averageRating != null ? (
            <span className="inline-flex items-center gap-0.5">
              <Star className="size-3 fill-accent text-accent" />
              <span className="tnum">{show.averageRating.toFixed(1)}</span>
            </span>
          ) : null}
          {show.memberCount ? (
            <span className="inline-flex items-center gap-0.5">
              <Users className="size-3" />
              <span className="tnum">{formatCompact(show.memberCount)}</span>
            </span>
          ) : null}
        </div>
        {footer}
      </div>
    </Link>
  );
}

/** Responsive poster grid used everywhere a set of shows is listed. */
export function ShowGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {children}
    </div>
  );
}
