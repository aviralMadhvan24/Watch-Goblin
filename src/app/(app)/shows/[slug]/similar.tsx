import { ShowCard, ShowGrid } from "@/components/shows/show-card";
import type { ShowType } from "@/generated/prisma/enums";
import { getSimilarShows } from "@/server/queries/recommendations";

/**
 * "More like this" for a show page.
 *
 * Needs no signed-in user, so it works for visitors arriving cold from a search
 * engine — which is the traffic most likely to want a second suggestion.
 *
 * Streamed in its own boundary: it is two queries plus a genre-rarity pass, and
 * the show's own synopsis, episode list and track controls should never wait on
 * a sidebar of related titles.
 */
export async function SimilarShows({ showId, type }: { showId: string; type: ShowType }) {
  const similar = await getSimilarShows(showId, type, 6);
  if (similar.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="font-display text-lg font-bold tracking-tight">More like this</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Shares the genres and studios that make this one what it is.
      </p>
      <div className="mt-4">
        <ShowGrid>
          {similar.map((show) => (
            <ShowCard key={show.id} show={show} />
          ))}
        </ShowGrid>
      </div>
    </section>
  );
}

/** Placeholder with the grid's shape, so the streamed section shifts nothing. */
export function SimilarShowsSkeleton() {
  return (
    <section className="mt-12" aria-hidden>
      <div className="h-6 w-40 animate-pulse rounded bg-surface-raised" />
      <div className="mt-1 h-4 w-72 animate-pulse rounded bg-surface-raised" />
      <div className="mt-4">
        <ShowGrid>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <div className="aspect-[2/3] w-full animate-pulse rounded-lg bg-surface-raised" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-surface-raised" />
            </div>
          ))}
        </ShowGrid>
      </div>
    </section>
  );
}
