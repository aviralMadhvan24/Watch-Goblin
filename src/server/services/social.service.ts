import "server-only";

import { db } from "@/db/client";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { activityService } from "@/server/services/activity.service";
import { achievementsService } from "@/server/services/achievements.service";

/**
 * Follows and blocks.
 *
 * `UserStats.followersCount` / `followingCount` are caches over the `follows`
 * table, so every write here moves both sides inside the same transaction.
 *
 * Blocking is not a stronger mute: it severs the relationship in both
 * directions and deletes any existing follow, because leaving a follow row
 * behind means the blocked user keeps appearing in feeds.
 */

export const socialService = {
  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw errors.validation("You cannot follow yourself. Touch grass.");
    }

    await enforceRateLimit("follow", `user:${followerId}`);

    return db.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: followingId },
        select: { id: true, username: true, isBanned: true },
      });
      if (!target || target.isBanned) throw errors.notFound("That account does not exist.");

      const blocked = await tx.block.findFirst({
        where: {
          OR: [
            { blockerId: followingId, blockedId: followerId },
            { blockerId: followerId, blockedId: followingId },
          ],
        },
        select: { blockerId: true },
      });
      if (blocked) throw errors.blocked("You cannot follow that account.");

      const existing = await tx.follow.findUnique({
        where: { followerId_followingId: { followerId, followingId } },
        select: { followerId: true },
      });
      // Following twice is a double-click, not an error.
      if (existing) return { following: true };

      await tx.follow.create({ data: { followerId, followingId } });
      await tx.userStats.update({
        where: { userId: followerId },
        data: { followingCount: { increment: 1 } },
      });
      await tx.userStats.update({
        where: { userId: followingId },
        data: { followersCount: { increment: 1 } },
      });

      await activityService.record(tx, {
        userId: followerId,
        type: "USER_FOLLOWED",
        targetUserId: followingId,
        payload: { username: target.username },
      });

      // A follow can unlock a "followers" achievement for the person followed.
      await achievementsService.evaluate(tx, followingId);

      logger.info("User followed", { followerId, followingId });
      return { following: true };
    });
  },

  async unfollow(followerId: string, followingId: string) {
    return db.$transaction(async (tx) => {
      const existing = await tx.follow.findUnique({
        where: { followerId_followingId: { followerId, followingId } },
        select: { followerId: true },
      });
      if (!existing) return { following: false };

      await tx.follow.delete({
        where: { followerId_followingId: { followerId, followingId } },
      });
      await tx.userStats.update({
        where: { userId: followerId },
        data: { followingCount: { decrement: 1 } },
      });
      await tx.userStats.update({
        where: { userId: followingId },
        data: { followersCount: { decrement: 1 } },
      });
      await tx.activity.deleteMany({
        where: { userId: followerId, targetUserId: followingId, type: "USER_FOLLOWED" },
      });

      logger.info("User unfollowed", { followerId, followingId });
      return { following: false };
    });
  },

  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) throw errors.validation("You cannot block yourself.");

    return db.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: blockedId },
        select: { id: true },
      });
      if (!target) throw errors.notFound("That account does not exist.");

      await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
      });

      // Sever both directions. Counters are corrected for whichever follows
      // actually existed, so this stays accurate however it was reached.
      const removed = await tx.follow.findMany({
        where: {
          OR: [
            { followerId: blockerId, followingId: blockedId },
            { followerId: blockedId, followingId: blockerId },
          ],
        },
        select: { followerId: true, followingId: true },
      });

      for (const follow of removed) {
        await tx.follow.delete({
          where: {
            followerId_followingId: {
              followerId: follow.followerId,
              followingId: follow.followingId,
            },
          },
        });
        await tx.userStats.update({
          where: { userId: follow.followerId },
          data: { followingCount: { decrement: 1 } },
        });
        await tx.userStats.update({
          where: { userId: follow.followingId },
          data: { followersCount: { decrement: 1 } },
        });
      }

      logger.info("User blocked", { blockerId, blockedId, followsRemoved: removed.length });
      return { blocked: true };
    });
  },

  async unblock(blockerId: string, blockedId: string) {
    await db.block
      .delete({ where: { blockerId_blockedId: { blockerId, blockedId } } })
      .catch(() => undefined);
    return { blocked: false };
  },

  /** Resolves a username to an id, for actions that receive a handle. */
  async resolveUserId(username: string): Promise<string> {
    const user = await db.user.findUnique({
      where: { username: username.toLowerCase() },
      select: { id: true, isBanned: true },
    });
    if (!user || user.isBanned) throw errors.notFound("That account does not exist.");
    return user.id;
  },
};
