import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { DiscoverFiltersBar } from "@/app/(app)/discover/filters";
import {
  RemoteResults,
  RemoteResultsSkeleton,
} from "@/app/(app)/discover/remote-results";
import { SimpleEmpty } from "@/components/shared/empty-state";
import { ShowCard, ShowGrid } from "@/components/shows/show-card";
import { Button } from "@/components/ui/button";
import type { AiringStatus, ShowType } from "@/generated/prisma/enums";
import { formatNumber } from "@/lib/format";
import { discoverShows, listGenres, type ShowSort } from "@/server/queries/shows";

export const metadata: Metadata = {
  title: "Discover",
  description: "Browse the catalogue and find your next obsession.",
};

const SORTS = new Set<ShowSort>(["popular", "rating", "newest", "members", "title"]);
const TYPES = new Set<ShowType>(["ANIME", "TV"]);
const AIRING = new Set<AiringStatus>(["UPCOMING", "AIRING", "ENDED", "CANCELLED"]);

/** Narrows a raw query-string value to a known option, or drops it. */
function pick<T extends string>(value: string | undefined, allowed: Set<string>): T | undefined {
  return value && allowed.has(value) ? (value as T) : undefined;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DiscoverPage({ searchParams }: PageProps<"/discover">) {
  const params = await searchParams;

  const q = one(params.q)?.trim() || undefined;
  const type = pick<ShowType>(one(params.type), TYPES);
  const genre = one(params.genre) || undefined;
  const airingStatus = pick<AiringStatus>(one(params.airing), AIRING);
  const sort = pick<ShowSort>(one(params.sort), SORTS) ?? "popular";
  const page = Math.max(1, Number(one(params.page) ?? 1) || 1);

  const [{ shows, total, pageCount }, genres] = await Promise.all([
    discoverShows({ q, type, genre, airingStatus, sort, page }),
    listGenres(),
  ]);

  // Carried onto the pagination links so paging does not drop the filters.
  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (type) query.set("type", type);
  if (genre) query.set("genre", genre);
  if (airingStatus) query.set("airing", airingStatus);
  if (sort !== "popular") query.set("sort", sort);

  const pageHref = (n: number) => {
    const next = new URLSearchParams(query);
    if (n > 1) next.set("page", String(n));
    const qs = next.toString();
    return qs ? `/discover?${qs}` : "/discover";
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Discover</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {formatNumber(total)} {total === 1 ? "show" : "shows"} in the catalogue.
        </p>
      </header>

      <DiscoverFiltersBar
        genres={genres}
        current={{ q, type, genre, airing: airingStatus, sort }}
      />

      {shows.length === 0 ? (
        q ? null : (
          <SimpleEmpty
            className="mt-8"
            title="Nothing matched"
            body="Either it does not exist or you cannot spell. Both are possible."
          />
        )
      ) : (
        <div className="mt-6">
          <ShowGrid>
            {shows.map((show) => (
              <ShowCard key={show.id} show={show} />
            ))}
          </ShowGrid>
        </div>
      )}

      {/* Streamed: the local grid above is already on screen while this waits
          on the provider. `key` restarts the boundary when the query changes,
          so a new search shows its own skeleton instead of stale results. */}
      {q ? (
        <Suspense key={`${q}:${type ?? ""}`} fallback={<RemoteResultsSkeleton />}>
          <RemoteResults q={q} type={type} localCount={shows.length} />
        </Suspense>
      ) : null}

      {pageCount > 1 ? (
        <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Pagination">
          <Button variant="secondary" size="sm" disabled={page <= 1} asChild={page > 1}>
            {page > 1 ? <Link href={pageHref(page - 1)}>Previous</Link> : <span>Previous</span>}
          </Button>
          <span className="tnum text-sm text-ink-muted">
            Page {page} of {pageCount}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= pageCount}
            asChild={page < pageCount}
          >
            {page < pageCount ? <Link href={pageHref(page + 1)}>Next</Link> : <span>Next</span>}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
