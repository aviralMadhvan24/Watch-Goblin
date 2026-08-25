import "server-only";

import { xpDedupeKey } from "@/config/xp";
import { db } from "@/db/client";
import type { Visibility } from "@/generated/prisma/enums";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { xpService } from "@/server/services/xp.service";

/**
 * Profile settings and the favourites shelf.
 *
 * "Profile completed" XP is awarded once, the first time the profile has a real
 * display name, a bio and an avatar. The dedupe key is constant per user, so
 * emptying the bio and refilling it pays nothing.
 */

const MAX_FAVORITES = 6;

export interface ProfileUpdate {
  displayName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  accentColor?: string;
  visibility?: Visibility;
  activityVisibility?: Visibility;
  humorEnabled?: boolean;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const profileService = {
  async update(userId: string, input: ProfileUpdate) {
    await enforceRateLimit("updateProfile", `user:${userId}`);

    const data: ProfileUpdate = {};

    if (input.displayName !== undefined) {
      const name = input.displayName.trim();
      if (name.length < 1 || name.length > 40) {
        throw errors.validation("Display names run 1 to 40 characters.", {
          displayName: ["Display names run 1 to 40 characters."],
        });
      }
      data.displayName = name;
    }

    if (input.bio !== undefined) {
      const bio = input.bio?.trim() ?? "";
      if (bio.length > 280) {
        throw errors.validation("That bio is too long.", {
          bio: ["Bios cap out at 280 characters."],
        });
      }
      data.bio = bio || null;
    }

    if (input.accentColor !== undefined) {
      if (!HEX_COLOR.test(input.accentColor)) {
        throw errors.validation("That is not a valid colour.", {
          accentColor: ["Use a hex colour like #8b5cf6."],
        });
      }
      data.accentColor = input.accentColor;
    }

    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl || null;
    if (input.bannerUrl !== undefined) data.bannerUrl = input.bannerUrl || null;
    if (input.visibility !== undefined) data.visibility = input.visibility;
    if (input.activityVisibility !== undefined) {
      data.activityVisibility = input.activityVisibility;
    }
    if (input.humorEnabled !== undefined) data.humorEnabled = input.humorEnabled;

    const profile = await db.$transaction(async (tx) => {
      const updated = await tx.profile.update({
        where: { userId },
        data,
        select: { displayName: true, bio: true, avatarUrl: true },
      });

      const complete =
        updated.bio !== null && updated.bio.length > 0 && updated.avatarUrl !== null;

      if (complete) {
        await xpService.award(tx, userId, "PROFILE_COMPLETED", xpDedupeKey.profileCompleted());
      }

      return updated;
    });

    logger.info("Profile updated", { userId, fields: Object.keys(data) });
    return profile;
  },

  /**
   * Replaces the favourites shelf wholesale. Slots are re-derived from array
   * order, so reordering is the same operation as adding or removing.
   */
  async setFavoriteShows(userId: string, showIds: string[]) {
    const unique = [...new Set(showIds)].slice(0, MAX_FAVORITES);

    await db.$transaction(async (tx) => {
      const found = await tx.show.findMany({
        where: { id: { in: unique } },
        select: { id: true },
      });
      const valid = new Set(found.map((s) => s.id));

      await tx.userFavoriteShow.deleteMany({ where: { userId } });

      let slot = 0;
      for (const showId of unique) {
        if (!valid.has(showId)) continue;
        await tx.userFavoriteShow.create({ data: { userId, showId, slot } });
        slot += 1;
      }
    });

    return { ok: true as const };
  },

  /** Everything the settings form needs, in one query. */
  async getSettings(userId: string) {
    const profile = await db.profile.findUnique({
      where: { userId },
      select: {
        displayName: true,
        bio: true,
        avatarUrl: true,
        bannerUrl: true,
        accentColor: true,
        visibility: true,
        activityVisibility: true,
        humorEnabled: true,
      },
    });
    if (!profile) throw errors.notFound("Profile not found.");
    return profile;
  },
};
