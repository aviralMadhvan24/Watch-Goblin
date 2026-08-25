"use client";

import { useRouter } from "next/navigation";
import { Check, UserMinus, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { toggleFollowAction } from "@/features/social/actions";

/**
 * Follow toggle.
 *
 * Optimistic, and reverts on failure — the failure case here is real (blocks,
 * rate limits), so the button must not be left claiming a relationship the
 * server refused.
 */
export function FollowButton({
  username,
  initialFollowing,
  size = "md",
  refreshOnChange = true,
}: {
  username: string;
  initialFollowing: boolean;
  size?: "sm" | "md";
  /**
   * Re-renders the server component after a successful toggle, so follower
   * counts update. Suggestion lists pass `false`: their query excludes people
   * you already follow, so refreshing would make the card you just clicked
   * disappear and be replaced by a stranger showing "Follow" again.
   */
  refreshOnChange?: boolean;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [hovering, setHovering] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size={size}
      variant={following ? "secondary" : "primary"}
      loading={pending}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={() =>
        startTransition(async () => {
          const next = !following;
          setFollowing(next);

          const result = await toggleFollowAction(username, next);
          if (!result.ok || !result.data) {
            setFollowing(!next);
            toast.error(result.message ?? "That did not stick.");
            return;
          }
          setFollowing(result.data.following);
          if (refreshOnChange) router.refresh();
        })
      }
    >
      {following ? (
        hovering ? (
          <>
            <UserMinus /> Unfollow
          </>
        ) : (
          <>
            <Check /> Following
          </>
        )
      ) : (
        <>
          <UserPlus /> Follow
        </>
      )}
    </Button>
  );
}
