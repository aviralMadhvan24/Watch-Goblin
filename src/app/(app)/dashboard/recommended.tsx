import { RecommendationGrid } from "@/components/shows/recommendation-grid";
import { ShowGrid } from "@/components/shows/show-card";
import { getRecommendations } from "@/server/queries/recommendations";

/**
 * The dashboard's recommendation shelf.
 *
 * Split into its own async component so the page can stream: scoring the
 * catalogue is several queries, and the level card, stats and continue-watching
 * row have no reason to wait behind it.
 */
export async function RecommendedForYou({ userId }: { userId: string }) {
  const recommendations = await getRecommendations(userId, 6);
  if (recommendations.length === 0) return null;

  return <RecommendationGrid recommendations={recommendations} />;
}

/** Matches the grid's shape so the streamed shelf does not shift the page. */
export function RecommendedSkeleton() {
  return (
    <ShowGrid aria-hidden>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="space-y-2">
          <div className="aspect-[2/3] w-full animate-pulse rounded-lg bg-surface-raised" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-surface-raised" />
          <div className="h-3 w-full animate-pulse rounded bg-surface-raised" />
        </div>
      ))}
    </ShowGrid>
  );
}
