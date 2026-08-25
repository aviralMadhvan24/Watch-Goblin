import { Suspense } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { Calendar, Clapperboard, Star, Users } from "lucide-react";

import { SimilarShows, SimilarShowsSkeleton } from "@/app/(app)/shows/[slug]/similar";
import { EpisodeList } from "@/components/shows/episode-list";
import { SimpleEmpty } from "@/components/shared/empty-state";
import { Poster } from "@/components/shows/poster";
import { ReviewSection } from "@/components/shows/review-section";
import { StarRating } from "@/components/shows/star-rating";
import { TrackPanel } from "@/components/shows/track-panel";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatCompact, formatNumber, formatYear } from "@/lib/format";
import { checkRateLimit, retryAfterLabel } from "@/lib/rate-limit";
import { db } from "@/db/client";
import { metadataProvider } from "@/server/integrations/metadata";
import { getOptionalSession, rateLimitIdentity } from "@/server/auth/session";
import { catalogService } from "@/server/services/catalog.service";
import {
  getShowDetail,
  getViewerReview,
  listShowReviews,
} from "@/server/queries/shows";

export async function generateMetadata({ params }: PageProps<"/shows/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const show = await getShowDetail(slug);
  if (!show) return { title: "Show not found" };

  return {
    title: show.title,
    description: show.synopsis?.slice(0, 160) ?? undefined,
  };
}

/**
 * Cards for shows we have never imported link to `/shows/tmdb-12345`. Slugs are
 * generated from titles, so a real one can only collide with this if a show is
 * literally called "Tmdb 12345" — and even then the local lookup runs first and
 * wins, because this is only consulted after that misses.
 */
function parseProviderSlug(slug: string): { provider: string; externalId: string } | null {
  const match = /^([a-z]+)-(\d+)$/.exec(slug);
  if (!match) return null;
  const [, provider, externalId] = match;
  return provider === metadataProvider.name ? { provider, externalId } : null;
}

const AIRING_LABELS = {
  UPCOMING: "Upcoming",
  AIRING: "Airing",
  ENDED: "Ended",
  CANCELLED: "Cancelled",
} as const;

export default async function ShowPage({ params }: PageProps<"/shows/[slug]">) {
  const { slug } = await params;
  const session = await getOptionalSession();
  const viewerId = session?.user.id ?? null;

  const show = await getShowDetail(slug, viewerId);

  // Cache miss: the catalogue has never seen this show, so import it now and
  // send the user to its canonical slug. Redirecting rather than rendering at
  // the provider-id URL keeps one address per show, so links and metadata stay
  // stable once the row exists.
  if (!show) {
    const external = parseProviderSlug(slug);
    if (!external) notFound();

    // This branch is the one URL on the site that turns an anonymous GET into
    // an unbounded write: a season tree is a request per season and can be
    // thousands of episode rows. Ids are sequential and guessable, so without a
    // limit here someone can walk them and make us import the whole of TMDB.
    // Charged against the same `search` budget as Discover, since both are the
    // same underlying resource: our provider quota.
    const budget = await checkRateLimit("search", await rateLimitIdentity(viewerId));
    if (!budget.allowed) {
      return (
        <div className="mx-auto w-full max-w-2xl px-5 py-16">
          <SimpleEmpty
            title="Give it a second"
            body={`We are fetching a lot of shows right now. Try again in ${retryAfterLabel(budget)}.`}
          />
        </div>
      );
    }

    const showId = await catalogService.ensureShowImported(
      metadataProvider,
      external.externalId,
    );
    if (!showId) notFound();

    const imported = await db.show.findUnique({
      where: { id: showId },
      select: { slug: true },
    });
    if (!imported) notFound();

    redirect(`/shows/${imported.slug}`);
  }

  const [reviews, viewerReview] = await Promise.all([
    listShowReviews(show.id, viewerId),
    viewerId ? getViewerReview(show.id, viewerId) : Promise.resolve(null),
  ]);

  const watched = show.userShow?.episodesWatched ?? 0;
  const progress =
    show.totalEpisodes > 0 ? Math.min(100, (watched / show.totalEpisodes) * 100) : 0;

  return (
    <article>
      {/* Backdrop band. Falls back to a flat gradient: not every show in the
          catalogue has a backdrop, so the empty case must look deliberate. */}
      <div className="relative h-40 overflow-hidden border-b border-line bg-gradient-to-br from-primary/20 via-surface to-ground sm:h-56">
        {show.backdropUrl ? (
          <Image
            src={show.backdropUrl}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-40"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-ground to-transparent" />
      </div>

      <div className="mx-auto w-full max-w-6xl px-5">
        {/* `relative z-10` is load-bearing: the negative margin pulls this row up
            over the backdrop, and without a stacking context the badges render
            behind the backdrop's gradient overlay. */}
        <div className="relative z-10 -mt-20 flex flex-col gap-6 sm:-mt-28 sm:flex-row">
          <div className="w-32 shrink-0 sm:w-44">
            <Poster src={show.posterUrl} title={show.title} />
          </div>

          <div className="flex-1 pt-2 sm:pt-24">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="primary" size="sm">
                {show.type === "ANIME" ? "Anime" : "TV"}
              </Badge>
              <Badge variant="outline" size="sm">
                {AIRING_LABELS[show.airingStatus]}
              </Badge>
            </div>

            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-balance sm:text-4xl">
              {show.title}
            </h1>
            {show.originalTitle && show.originalTitle !== show.title ? (
              <p className="mt-0.5 text-sm text-ink-faint">{show.originalTitle}</p>
            ) : null}

            <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-muted">
              {show.averageRating != null ? (
                <div className="flex items-center gap-1.5">
                  <Star className="size-4 fill-accent text-accent" />
                  <span className="tnum font-semibold text-ink">
                    {show.averageRating.toFixed(1)}
                  </span>
                  <span className="text-ink-faint">({formatNumber(show.ratingCount)})</span>
                </div>
              ) : null}
              <div className="flex items-center gap-1.5">
                <Clapperboard className="size-4" />
                <span className="tnum">{formatNumber(show.totalEpisodes)} episodes</span>
              </div>
              {show.firstAirDate ? (
                <div className="flex items-center gap-1.5">
                  <Calendar className="size-4" />
                  <span className="tnum">{formatYear(show.firstAirDate)}</span>
                </div>
              ) : null}
              <div className="flex items-center gap-1.5">
                <Users className="size-4" />
                <span className="tnum">{formatCompact(show.memberCount)} watching</span>
              </div>
            </dl>

            {show.genres.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {show.genres.map((genre) => (
                  <Badge key={genre.slug} variant="neutral" size="sm">
                    {genre.name}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0 space-y-8">
            {show.synopsis ? (
              <section>
                <h2 className="mb-2 font-display text-lg font-semibold">Synopsis</h2>
                <p className="text-sm leading-relaxed text-ink-muted text-pretty">
                  {show.synopsis}
                </p>
              </section>
            ) : null}

            {show.userShow ? (
              <section>
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="font-display text-lg font-semibold">Your progress</h2>
                  <span className="tnum text-sm text-ink-muted">
                    {watched} / {show.totalEpisodes} · {Math.round(progress)}%
                  </span>
                </div>
                <ProgressBar value={progress} size="md" />
              </section>
            ) : null}

            <section>
              <h2 className="mb-3 font-display text-lg font-semibold">Episodes</h2>
              <EpisodeList
                showId={show.id}
                showSlug={show.slug}
                seasons={show.seasons}
                watchedIds={show.watchedEpisodeIds}
                canTrack={Boolean(viewerId)}
              />
            </section>

            <section>
              <h2 className="mb-3 font-display text-lg font-semibold">
                Reviews{" "}
                <span className="tnum font-sans text-sm font-normal text-ink-faint">
                  {reviews.length}
                </span>
              </h2>
              <ReviewSection
                showId={show.id}
                showSlug={show.slug}
                reviews={reviews}
                viewerUsername={session?.user.username ?? null}
                viewerReview={
                  viewerReview && !viewerReview.deletedAt
                    ? {
                        id: viewerReview.id,
                        rating: viewerReview.rating,
                        body: viewerReview.body,
                        hasSpoilers: viewerReview.hasSpoilers,
                      }
                    : null
                }
              />
            </section>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            {viewerId ? (
              <TrackPanel
                showId={show.id}
                showSlug={show.slug}
                totalEpisodes={show.totalEpisodes}
                humor={session?.user.humorEnabled ?? true}
                initial={show.userShow}
              />
            ) : (
              <div className="rounded-card border border-line bg-surface-raised p-4 text-sm text-ink-muted">
                Sign in to track episodes, rate this and earn XP nobody respects.
              </div>
            )}

            {show.averageRating != null ? (
              <div className="rounded-card border border-line p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                  Community rating
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <StarRating value={show.averageRating} readOnly size="sm" />
                  <span className="tnum text-sm text-ink">{show.averageRating.toFixed(2)}</span>
                </div>
              </div>
            ) : null}

            {show.cast.length > 0 ? (
              <div className="rounded-card border border-line p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
                  Cast
                </p>
                <ul className="space-y-1.5 text-sm">
                  {show.cast.slice(0, 8).map((member) => (
                    <li key={`${member.name}-${member.character}`} className="flex justify-between gap-2">
                      <span className="truncate text-ink">{member.name}</span>
                      {member.character ? (
                        <span className="truncate text-right text-ink-faint">
                          {member.character}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {show.credits.length > 0 ? (
              <div className="rounded-card border border-line p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
                  Studios &amp; networks
                </p>
                <ul className="space-y-1 text-sm text-ink-muted">
                  {show.credits.map((credit) => (
                    <li key={credit.name}>{credit.name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </div>

        {/* Streamed in its own boundary: the synopsis, episode list and track
            controls above are the page, and none of them should wait on a
            sidebar of related titles. */}
        <Suspense fallback={<SimilarShowsSkeleton />}>
          <SimilarShows showId={show.id} type={show.type} />
        </Suspense>
      </div>
    </article>
  );
}
