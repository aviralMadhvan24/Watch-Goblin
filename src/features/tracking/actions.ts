"use server";

import { revalidatePath } from "next/cache";

import type { WatchStatus } from "@/generated/prisma/enums";
import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireUser } from "@/server/auth/session";
import { trackingService, type TrackingOutcome } from "@/server/services/tracking.service";
import { fail, ok, type ActionResult } from "@/features/shared/action-result";

/**
 * Tracking actions — the core write loop.
 *
 * The client sends only *which* episode or show it means. Counts, progress,
 * XP, levels, streaks and completion state are all derived server-side, because
 * every one of them is something it would be worth lying about.
 *
 * Each action revalidates the pages whose server-rendered content the write
 * invalidates, so the dashboard and library reflect a click on a show page
 * without a manual refresh.
 */

export type TrackingResult = ActionResult<TrackingOutcome | null>;

function revalidateTracking(showSlug?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/library");
  revalidatePath("/feed");
  if (showSlug) revalidatePath(`/shows/${showSlug}`);
}

/** Wraps a tracking call so every action reports failures the same way. */
async function run(
  label: string,
  showSlug: string | undefined,
  fn: (userId: string) => Promise<TrackingOutcome | null>,
): Promise<TrackingResult> {
  try {
    const user = await requireUser();
    const outcome = await fn(user.id);
    revalidateTracking(showSlug);
    return ok(outcome);
  } catch (error) {
    if (!isAppError(error)) logger.error(`Tracking action failed: ${label}`, error);
    return fail(error);
  }
}

export async function markEpisodeWatchedAction(
  episodeId: string,
  showSlug?: string,
): Promise<TrackingResult> {
  return run("markEpisodeWatched", showSlug, (userId) =>
    trackingService.markEpisodeWatched(userId, episodeId),
  );
}

export async function unmarkEpisodeWatchedAction(
  episodeId: string,
  showSlug?: string,
): Promise<TrackingResult> {
  return run("unmarkEpisodeWatched", showSlug, (userId) =>
    trackingService.unmarkEpisodeWatched(userId, episodeId),
  );
}

export async function markSeasonWatchedAction(
  seasonId: string,
  showSlug?: string,
): Promise<TrackingResult> {
  return run("markSeasonWatched", showSlug, (userId) =>
    trackingService.markSeasonWatched(userId, seasonId),
  );
}

export async function markWatchedUpToAction(
  showId: string,
  seasonNumber: number,
  episodeNumber: number,
  showSlug?: string,
): Promise<TrackingResult> {
  return run("markWatchedUpTo", showSlug, (userId) =>
    trackingService.markWatchedUpTo(userId, showId, seasonNumber, episodeNumber),
  );
}

/** Marks the next unwatched episode. Returns null data when nothing is left. */
export async function continueWatchingAction(
  showId: string,
  showSlug?: string,
): Promise<TrackingResult> {
  return run("continueWatching", showSlug, (userId) =>
    trackingService.continueWatching(userId, showId),
  );
}

export async function addToLibraryAction(
  showId: string,
  status: WatchStatus,
  showSlug?: string,
): Promise<TrackingResult> {
  return run("addToLibrary", showSlug, (userId) =>
    trackingService.addToLibrary(userId, showId, { status }),
  );
}

export async function setStatusAction(
  showId: string,
  status: WatchStatus,
  showSlug?: string,
): Promise<TrackingResult> {
  return run("setStatus", showSlug, (userId) =>
    trackingService.setStatus(userId, showId, status),
  );
}

export async function rateShowAction(
  showId: string,
  rating: number | null,
  showSlug?: string,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await trackingService.rate(user.id, showId, rating);
    revalidateTracking(showSlug);
    return ok();
  } catch (error) {
    if (!isAppError(error)) logger.error("Tracking action failed: rate", error);
    return fail(error);
  }
}

export async function removeFromLibraryAction(
  showId: string,
  showSlug?: string,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await trackingService.removeFromLibrary(user.id, showId);
    revalidateTracking(showSlug);
    return ok();
  } catch (error) {
    if (!isAppError(error)) logger.error("Tracking action failed: removeFromLibrary", error);
    return fail(error);
  }
}
