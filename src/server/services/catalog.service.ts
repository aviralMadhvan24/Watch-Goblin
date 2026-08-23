import "server-only";

import { db, type DbClient } from "@/db/client";
import { slugify } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { ExternalShowDetail } from "@/server/integrations/metadata";

/**
 * Turns provider data into catalogue rows.
 *
 * Idempotent by construction: a show is identified by
 * (sourceProvider, sourceId), seasons by (showId, number) and episodes by
 * (seasonId, number), all unique in the schema. Importing the same show twice
 * updates it in place rather than duplicating it — which matters because both
 * the seed and the "user opened a show we have not cached yet" path go through
 * here.
 *
 * Existing user progress survives a re-import: episodes are matched by season
 * and number, so a re-synced episode keeps its id and every `user_episodes` row
 * pointing at it.
 */

export const catalogService = {
  /**
   * Inserts or updates a show and its whole season/episode tree.
   * Runs in one transaction so a show is never half-imported.
   */
  async importShow(detail: ExternalShowDetail, client: DbClient = db): Promise<string> {
    const slug = await this.uniqueSlug(detail.title, detail.provider, detail.externalId, client);

    const show = await client.show.upsert({
      where: {
        show_source_identity: {
          sourceProvider: detail.provider,
          sourceId: detail.externalId,
        },
      },
      create: {
        slug,
        type: detail.type,
        title: detail.title,
        originalTitle: detail.originalTitle ?? null,
        synopsis: detail.synopsis ?? null,
        posterUrl: detail.posterUrl ?? null,
        backdropUrl: detail.backdropUrl ?? null,
        airingStatus: detail.airingStatus,
        firstAirDate: detail.firstAirDate ?? null,
        lastAirDate: detail.lastAirDate ?? null,
        averageRuntimeMinutes: detail.averageRuntimeMinutes,
        originalLanguage: detail.originalLanguage,
        popularity: detail.popularity,
        externalRating: detail.externalRating ?? null,
        sourceProvider: detail.provider,
        sourceId: detail.externalId,
      },
      update: {
        // Deliberately does not touch slug (URLs must stay stable) or the
        // community rating caches (they are ours, not the provider's).
        title: detail.title,
        originalTitle: detail.originalTitle ?? null,
        synopsis: detail.synopsis ?? null,
        posterUrl: detail.posterUrl ?? null,
        backdropUrl: detail.backdropUrl ?? null,
        airingStatus: detail.airingStatus,
        firstAirDate: detail.firstAirDate ?? null,
        lastAirDate: detail.lastAirDate ?? null,
        averageRuntimeMinutes: detail.averageRuntimeMinutes,
        popularity: detail.popularity,
        externalRating: detail.externalRating ?? null,
      },
      select: { id: true },
    });

    await this.syncGenres(client, show.id, detail.genres);
    await this.syncCredits(client, show.id, detail.credits ?? []);
    await this.syncCast(client, show.id, detail.cast ?? []);
    const totals = await this.syncSeasons(client, show.id, detail.seasons ?? []);

    await client.show.update({
      where: { id: show.id },
      data: {
        totalSeasons: totals.seasons,
        totalEpisodes: totals.episodes,
      },
    });

    logger.debug("Imported show", { showId: show.id, title: detail.title, ...totals });
    return show.id;
  },

  /**
   * Slugs are the public URL, so they must be unique and must never change once
   * assigned. A collision gets a numeric suffix.
   */
  async uniqueSlug(
    title: string,
    provider: string,
    externalId: string,
    client: DbClient = db,
  ): Promise<string> {
    const existing = await client.show.findUnique({
      where: { show_source_identity: { sourceProvider: provider, sourceId: externalId } },
      select: { slug: true },
    });
    if (existing) return existing.slug;

    const base = slugify(title) || "show";
    let candidate = base;

    for (let suffix = 2; suffix < 100; suffix++) {
      const taken = await client.show.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
      candidate = `${base}-${suffix}`;
    }

    return `${base}-${externalId}`;
  },

  async syncGenres(client: DbClient, showId: string, names: string[]): Promise<void> {
    if (names.length === 0) return;

    const genres = await Promise.all(
      names.map((name) =>
        client.genre.upsert({
          where: { slug: slugify(name) },
          create: { slug: slugify(name), name },
          update: {},
          select: { id: true },
        }),
      ),
    );

    await client.showGenre.createMany({
      data: genres.map((genre) => ({ showId, genreId: genre.id })),
      skipDuplicates: true,
    });
  },

  async syncCredits(
    client: DbClient,
    showId: string,
    credits: { name: string; kind: "STUDIO" | "NETWORK" }[],
  ): Promise<void> {
    if (credits.length === 0) return;

    const rows = await Promise.all(
      credits.map((credit) =>
        client.credit.upsert({
          where: { slug: slugify(`${credit.kind}-${credit.name}`) },
          create: { slug: slugify(`${credit.kind}-${credit.name}`), name: credit.name, kind: credit.kind },
          update: {},
          select: { id: true },
        }),
      ),
    );

    await client.showCredit.createMany({
      data: rows.map((row) => ({ showId, creditId: row.id })),
      skipDuplicates: true,
    });
  },

  async syncCast(
    client: DbClient,
    showId: string,
    cast: { name: string; character?: string | null; photoUrl?: string | null; order: number }[],
  ): Promise<void> {
    for (const member of cast) {
      const person = await client.person.upsert({
        where: { slug: slugify(member.name) },
        create: { slug: slugify(member.name), name: member.name, photoUrl: member.photoUrl ?? null },
        update: { photoUrl: member.photoUrl ?? undefined },
        select: { id: true },
      });

      const existing = await client.castMember.findFirst({
        where: { showId, personId: person.id, character: member.character ?? null },
        select: { id: true },
      });

      if (existing) {
        await client.castMember.update({ where: { id: existing.id }, data: { order: member.order } });
      } else {
        await client.castMember.create({
          data: {
            showId,
            personId: person.id,
            character: member.character ?? null,
            order: member.order,
          },
        });
      }
    }
  },

  /**
   * Upserts seasons and episodes, returning the true totals counted from the
   * rows we actually stored rather than trusting the provider's own counts —
   * progress percentages are computed against these numbers, so they have to
   * match reality.
   */
  async syncSeasons(
    client: DbClient,
    showId: string,
    seasons: ExternalShowDetail["seasons"],
  ): Promise<{ seasons: number; episodes: number }> {
    let episodeTotal = 0;
    let seasonTotal = 0;

    for (const season of seasons) {
      const seasonRow = await client.season.upsert({
        where: { showId_number: { showId, number: season.number } },
        create: {
          showId,
          number: season.number,
          title: season.title ?? null,
          overview: season.overview ?? null,
          posterUrl: season.posterUrl ?? null,
          airDate: season.airDate ?? null,
          episodeCount: season.episodes.length,
        },
        update: {
          title: season.title ?? null,
          overview: season.overview ?? null,
          posterUrl: season.posterUrl ?? null,
          airDate: season.airDate ?? null,
          episodeCount: season.episodes.length,
        },
        select: { id: true },
      });

      for (const episode of season.episodes) {
        await client.episode.upsert({
          where: { seasonId_number: { seasonId: seasonRow.id, number: episode.number } },
          create: {
            showId,
            seasonId: seasonRow.id,
            seasonNumber: season.number,
            number: episode.number,
            title: episode.title ?? null,
            overview: episode.overview ?? null,
            airDate: episode.airDate ?? null,
            runtimeMinutes: episode.runtimeMinutes ?? null,
            stillUrl: episode.stillUrl ?? null,
          },
          update: {
            seasonNumber: season.number,
            title: episode.title ?? null,
            overview: episode.overview ?? null,
            airDate: episode.airDate ?? null,
            runtimeMinutes: episode.runtimeMinutes ?? null,
            stillUrl: episode.stillUrl ?? null,
          },
        });
      }

      // Specials (season 0) are excluded from totals so a show with specials
      // can still reach 100%.
      if (season.number > 0) {
        seasonTotal += 1;
        episodeTotal += season.episodes.length;
      }
    }

    return { seasons: seasonTotal, episodes: episodeTotal };
  },

  /**
   * Returns the local show for a provider id, importing it on first sight.
   * This is what lets a user open a show the catalogue has never seen.
   */
  async ensureShowImported(
    provider: { getShow(id: string): Promise<ExternalShowDetail | null> },
    externalId: string,
  ): Promise<string | null> {
    const detail = await provider.getShow(externalId);
    if (!detail) return null;
    return db.$transaction((tx) => this.importShow(detail, tx), { timeout: 30_000 });
  },
};
