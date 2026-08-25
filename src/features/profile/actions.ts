"use server";

import { revalidatePath } from "next/cache";

import type { Visibility } from "@/generated/prisma/enums";
import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireUser } from "@/server/auth/session";
import { authService } from "@/server/services/auth.service";
import { profileService } from "@/server/services/profile.service";
import { fail, ok, type ActionResult } from "@/features/shared/action-result";

/** Settings: profile fields, privacy, and password change. */

const VISIBILITIES = new Set<Visibility>(["PUBLIC", "FOLLOWERS", "PRIVATE"]);

function visibility(form: FormData, key: string): Visibility | undefined {
  const value = form.get(key);
  if (typeof value !== "string") return undefined;
  return VISIBILITIES.has(value as Visibility) ? (value as Visibility) : undefined;
}

export async function updateProfileAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await requireUser();

    await profileService.update(user.id, {
      displayName: String(formData.get("displayName") ?? ""),
      bio: String(formData.get("bio") ?? ""),
      avatarUrl: String(formData.get("avatarUrl") ?? ""),
      accentColor: String(formData.get("accentColor") ?? "#8b5cf6"),
      visibility: visibility(formData, "visibility"),
      activityVisibility: visibility(formData, "activityVisibility"),
      // An unchecked checkbox is simply absent from the FormData, so its
      // absence is the "off" signal rather than a missing value.
      humorEnabled: formData.get("humorEnabled") === "on",
    });

    revalidatePath("/settings");
    revalidatePath(`/u/${user.username}`);
    return { ...ok(), message: "Saved." };
  } catch (error) {
    if (!isAppError(error)) logger.error("Profile action failed: update", error);
    return fail(error);
  }
}

export async function changePasswordAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await authService.changePassword(user.id, {
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });
    return { ...ok(), message: "Password changed. Every other device was signed out." };
  } catch (error) {
    if (!isAppError(error)) logger.error("Profile action failed: changePassword", error);
    return fail(error);
  }
}

export async function setFavoriteShowsAction(showIds: string[]): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await profileService.setFavoriteShows(user.id, showIds);
    revalidatePath(`/u/${user.username}`);
    return ok();
  } catch (error) {
    if (!isAppError(error)) logger.error("Profile action failed: setFavoriteShows", error);
    return fail(error);
  }
}
