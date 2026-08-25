import { ShowCard, ShowGrid } from "@/components/shows/show-card";
import type { ShowType } from "@/generated/prisma/enums";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOptionalSession, rateLimitIdentity } from "@/server/auth/session";
import { metadataProvider } from "@/server/integrations/metadata";
import { catalogService } from "@/server/services/catalog.service";

/**
 * Below this many local hits we stop assuming the catalogue has the answer and
 * ask the provider as well. Above it, a search that found plenty of shows does
 * not need to spend requests proving there are more.
 */
const LOCAL_RESULTS_CONSIDERED_ENOUGH = 6;

/**
 * The "not in the catalogue yet" half of a search.
 *
 * Rendered inside a Suspense boundary so it never delays the local grid: the
 * page streams the database results immediately and this section arrives when
 * the provider answers, which is the difference between a search that feels
 * instant and one that waits on a third party.
 *
 * Cards link to `/shows/tmdb-<id>`, which the show route resolves by importing
 * on demand — so nothing here writes to the database until a user picks one.
 *
 * Rate limited because this page is public and this section is expensive on
 * someone else's budget: one `?q=` costs a `/search/tv` call plus a detail
 * lookup per candidate for the keyword gate. Without a limit, a loop over this
 * URL is an unauthenticated way to burn the TMDB quota. Over budget we simply
 * do not ask the provider — the local grid above has already rendered, so the
 * page is still useful.
 */
export async function RemoteResults({
  q,
  type,
  localCount,
}: {
  q: string;
  type?: ShowType;
  localCount: number;
}) {
  if (localCount >= LOCAL_RESULTS_CONSIDERED_ENOUGH) return null;

  // `getOptionalSession` is React-cached, so this is free: the layout has
  // already resolved it for this request.
  const session = await getOptionalSession();
  const budget = await checkRateLimit("search", await rateLimitIdentity(session?.user.id));
  if (!budget.allowed) return null;

  const remote = await catalogService.searchRemote(metadataProvider, q, type);
  if (remote.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-bold tracking-tight">Not in the catalogue yet</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Found on {metadataProvider.name.toUpperCase()}. Open one and it gets added.
      </p>

      <div className="mt-4">
        <ShowGrid>
          {remote.map((show) => (
            <ShowCard
              key={show.externalId}
              show={{
                // Resolved and redirected to a real slug by the show route.
                slug: `${show.provider}-${show.externalId}`,
                title: show.title,
                posterUrl: show.posterUrl ?? null,
                type: show.type,
                firstAirDate: show.firstAirDate,
              }}
            />
          ))}
        </ShowGrid>
      </div>
    </section>
  );
}

/** Matches the grid's shape so the streamed section does not shift layout. */
export function RemoteResultsSkeleton() {
  return (
    <section className="mt-10" aria-hidden>
      <div className="h-6 w-56 animate-pulse rounded bg-surface-raised" />
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
