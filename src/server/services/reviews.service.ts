import "server-only";

import { REVIEW_LIKE_XP_CAP, xpDedupeKey } from "@/config/xp";
import { db, type DbClient } from "@/db/client";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { activityService } from "@/server/services/activity.service";
import { achievementsService } from "@/server/services/achievements.service";
import { isValidRating, trackingService } from "@/server/services/tracking.service";
import { xpService } from "@/server/services/xp.service";

/**
 * Reviews, likes and comments.
 *
 * Two invariants this file exists to hold:
 *
 *  1. **A review carries a rating, and that rating is the user's rating of the
 *     show.** Posting a review therefore writes through to `UserShow.rating`
 *     via the tracking service, so the two can never disagree.
 *
 *  2. **Counters are updated in the same transaction as the fact.**
 *     `Review.likeCount`, `Review.commentCount` and the `UserStats` mirrors are
 *     caches; they are only correct if nothing can write the fact without
 *     writing the counter.
 *
 * Deletes are soft (`deletedAt`) so moderation keeps an audit trail, which is
 * why every read filters on `deletedAt: null`.
 */

const MAX_BODY = 5000;
const MAX_COMMENT = 2000;

export const reviewsService = {
  /**
   * Creates or updates the caller's review of a show. One review per user per
   * show, enforced by a unique index — editing is the only way to "post again".
   */
  async upsert(
    userId: string,
    showId: string,
    input: { rating: number; body: string; hasSpoilers?: boolean },
  ) {
    const body = input.body.trim();

    if (!isValidRating(input.rating)) {
      throw errors.validation("Ratings go from 0.5 to 5 stars, in halves.", {
        rating: ["Pick a rating between half a star and five."],
      });
    }
    if (body.length < 1) {
      throw errors.validation("Write something first.", { body: ["Write something first."] });
    }
    if (body.length > MAX_BODY) {
      throw errors.validation("That review is too long.", {
        body: [`Reviews cap out at ${MAX_BODY} characters.`],
      });
    }

    await enforceRateLimit("writeReview", `user:${userId}`);

    const result = await db.$transaction(async (tx) => {
      const show = await tx.show.findUnique({
        where: { id: showId },
        select: { id: true, title: true, slug: true, posterUrl: true },
      });
      if (!show) throw errors.notFound("That show is not in the catalogue.");

      const existing = await tx.review.findUnique({
        where: { userId_showId: { userId, showId } },
        select: { id: true, deletedAt: true },
      });

      const review = await tx.review.upsert({
        where: { userId_showId: { userId, showId } },
        create: {
          userId,
          showId,
          rating: input.rating,
          body,
          hasSpoilers: input.hasSpoilers ?? false,
        },
        update: {
          rating: input.rating,
          body,
          hasSpoilers: input.hasSpoilers ?? false,
          // Re-posting after a soft delete revives the row rather than
          // colliding with the unique index.
          deletedAt: null,
        },
        select: { id: true },
      });

      // A previously live review is an edit: no new XP, no new activity, and
      // the "reviews posted" counter must not move.
      const isNew = !existing || existing.deletedAt !== null;

      if (isNew) {
        await tx.userStats.update({
          where: { userId },
          data: { reviewsPosted: { increment: 1 } },
        });

        await xpService.award(tx, userId, "REVIEW_POSTED", xpDedupeKey.review(review.id), {
          payload: { showId, reviewId: review.id },
        });

        await activityService.record(tx, {
          userId,
          type: "REVIEW_POSTED",
          showId,
          reviewId: review.id,
          payload: {
            showTitle: show.title,
            showSlug: show.slug,
            posterUrl: show.posterUrl,
            rating: input.rating,
          },
        });

        await achievementsService.evaluate(tx, userId);
      }

      return { reviewId: review.id, isNew };
    });

    // Outside the transaction: rating a show runs its own transaction, and
    // nesting them would deadlock on the same UserShow row.
    await trackingService.rate(userId, showId, input.rating);

    logger.info("Review saved", { userId, showId, isNew: result.isNew });
    return result;
  },

  /** Soft-deletes the caller's review and rolls the counter back. */
  async remove(userId: string, reviewId: string) {
    await db.$transaction(async (tx) => {
      const review = await tx.review.findUnique({
        where: { id: reviewId },
        select: { id: true, userId: true, deletedAt: true },
      });

      if (!review || review.deletedAt) throw errors.notFound("That review is gone already.");
      if (review.userId !== userId) throw errors.forbidden("That is not your review.");

      await tx.review.update({ where: { id: reviewId }, data: { deletedAt: new Date() } });
      await tx.userStats.update({
        where: { userId },
        data: { reviewsPosted: { decrement: 1 } },
      });
      // The activity entry goes too: a feed item linking to a deleted review is
      // a dead end.
      await tx.activity.deleteMany({ where: { reviewId, type: "REVIEW_POSTED" } });
    });

    logger.info("Review deleted", { userId, reviewId });
    return { ok: true as const };
  },

  /**
   * Toggles a like. Returns the resulting state so the client can reconcile
   * without a second round trip.
   */
  async toggleLike(userId: string, reviewId: string) {
    await enforceRateLimit("like", `user:${userId}`);

    return db.$transaction(async (tx) => {
      const review = await tx.review.findUnique({
        where: { id: reviewId },
        select: { id: true, userId: true, deletedAt: true, likeCount: true },
      });
      if (!review || review.deletedAt) throw errors.notFound("That review is gone.");
      if (review.userId === userId) {
        throw errors.validation("Liking your own review does not count.");
      }

      const existing = await tx.reviewLike.findUnique({
        where: { reviewId_userId: { reviewId, userId } },
        select: { reviewId: true },
      });

      if (existing) {
        await tx.reviewLike.delete({ where: { reviewId_userId: { reviewId, userId } } });
        await tx.review.update({ where: { id: reviewId }, data: { likeCount: { decrement: 1 } } });
        await tx.userStats.update({
          where: { userId: review.userId },
          data: { reviewLikesReceived: { decrement: 1 } },
        });
        return { liked: false, likeCount: Math.max(0, review.likeCount - 1) };
      }

      await tx.reviewLike.create({ data: { reviewId, userId } });
      await tx.review.update({ where: { id: reviewId }, data: { likeCount: { increment: 1 } } });

      const authorStats = await tx.userStats.update({
        where: { userId: review.userId },
        data: { reviewLikesReceived: { increment: 1 } },
        select: { reviewLikesReceived: true },
      });

      // XP for likes is capped so a ring of accounts cannot farm it, and the
      // dedupe key is per-liker so unlike/relike pays nothing.
      if (authorStats.reviewLikesReceived <= REVIEW_LIKE_XP_CAP) {
        await xpService.award(
          tx,
          review.userId,
          "REVIEW_LIKED",
          xpDedupeKey.reviewLike(reviewId, userId),
          { payload: { reviewId, likerId: userId } },
        );
      }

      await achievementsService.evaluate(tx, review.userId);

      return { liked: true, likeCount: review.likeCount + 1 };
    });
  },

  async comment(userId: string, reviewId: string, body: string) {
    const text = body.trim();
    if (!text) throw errors.validation("Write something first.");
    if (text.length > MAX_COMMENT) {
      throw errors.validation(`Comments cap out at ${MAX_COMMENT} characters.`);
    }

    await enforceRateLimit("comment", `user:${userId}`);

    return db.$transaction(async (tx) => {
      const review = await tx.review.findUnique({
        where: { id: reviewId },
        select: { id: true, deletedAt: true },
      });
      if (!review || review.deletedAt) throw errors.notFound("That review is gone.");

      const comment = await tx.comment.create({
        data: { reviewId, userId, body: text },
        select: { id: true },
      });
      await tx.review.update({
        where: { id: reviewId },
        data: { commentCount: { increment: 1 } },
      });

      return { commentId: comment.id };
    });
  },

  async listComments(reviewId: string, client: DbClient = db) {
    return client.comment.findMany({
      where: { reviewId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        body: true,
        createdAt: true,
        user: {
          select: {
            username: true,
            profile: { select: { displayName: true, avatarUrl: true, accentColor: true } },
          },
        },
      },
    });
  },
};
