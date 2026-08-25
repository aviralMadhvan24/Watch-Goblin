"use server";

import { revalidatePath } from "next/cache";

import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireUser } from "@/server/auth/session";
import { socialService } from "@/server/services/social.service";
import { fail, ok, type ActionResult } from "@/features/shared/action-result";

/** Follow / unfollow / block, addressed by username rather than internal id. */

export async function toggleFollowAction(
  username: string,
  shouldFollow: boolean,
): Promise<ActionResult<{ following: boolean }>> {
  try {
    const user = await requireUser();
    const targetId = await socialService.resolveUserId(username);

    const result = shouldFollow
      ? await socialService.follow(user.id, targetId)
      : await socialService.unfollow(user.id, targetId);

    revalidatePath(`/u/${username}`);
    revalidatePath("/feed");
    // Deliberately NOT /people: a server action re-renders the current route
    // for anything it revalidates, and the suggestion query excludes people you
    // already follow — so revalidating here would delete the card the user just
    // clicked and slide a stranger into its place, still reading "Follow".
    return ok(result);
  } catch (error) {
    if (!isAppError(error)) logger.error("Social action failed: toggleFollow", error);
    return fail(error);
  }
}

export async function blockUserAction(username: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const targetId = await socialService.resolveUserId(username);
    await socialService.block(user.id, targetId);
    revalidatePath(`/u/${username}`);
    revalidatePath("/feed");
    return ok();
  } catch (error) {
    if (!isAppError(error)) logger.error("Social action failed: block", error);
    return fail(error);
  }
}

export async function unblockUserAction(username: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const targetId = await socialService.resolveUserId(username);
    await socialService.unblock(user.id, targetId);
    revalidatePath(`/u/${username}`);
    return ok();
  } catch (error) {
    if (!isAppError(error)) logger.error("Social action failed: unblock", error);
    return fail(error);
  }
}
