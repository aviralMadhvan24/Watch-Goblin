"use server";

import { revalidatePath } from "next/cache";

import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireUser } from "@/server/auth/session";
import { reviewsService } from "@/server/services/reviews.service";
import { fail, ok, type ActionResult } from "@/features/shared/action-result";

/** Review, like and comment actions. */

export interface ReviewFormState extends ActionResult {
  /** Echoed back so the form can repaint what the user typed after a failure. */
  values?: { rating: number; body: string; hasSpoilers: boolean };
}

export async function saveReviewAction(
  _prev: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const showId = String(formData.get("showId") ?? "");
  const showSlug = String(formData.get("showSlug") ?? "");
  const rating = Number(formData.get("rating") ?? 0);
  const body = String(formData.get("body") ?? "");
  const hasSpoilers = formData.get("hasSpoilers") === "on";

  try {
    const user = await requireUser();
    await reviewsService.upsert(user.id, showId, { rating, body, hasSpoilers });
    if (showSlug) revalidatePath(`/shows/${showSlug}`);
    revalidatePath("/feed");
    return ok();
  } catch (error) {
    if (!isAppError(error)) logger.error("Review action failed: save", error);
    return { ...fail(error), values: { rating, body, hasSpoilers } };
  }
}

export async function deleteReviewAction(
  reviewId: string,
  showSlug?: string,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await reviewsService.remove(user.id, reviewId);
    if (showSlug) revalidatePath(`/shows/${showSlug}`);
    revalidatePath("/feed");
    return ok();
  } catch (error) {
    if (!isAppError(error)) logger.error("Review action failed: delete", error);
    return fail(error);
  }
}

export async function toggleReviewLikeAction(
  reviewId: string,
): Promise<ActionResult<{ liked: boolean; likeCount: number }>> {
  try {
    const user = await requireUser();
    const result = await reviewsService.toggleLike(user.id, reviewId);
    return ok(result);
  } catch (error) {
    if (!isAppError(error)) logger.error("Review action failed: toggleLike", error);
    return fail(error);
  }
}

export async function commentAction(
  reviewId: string,
  body: string,
  showSlug?: string,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await reviewsService.comment(user.id, reviewId, body);
    if (showSlug) revalidatePath(`/shows/${showSlug}`);
    return ok();
  } catch (error) {
    if (!isAppError(error)) logger.error("Review action failed: comment", error);
    return fail(error);
  }
}
