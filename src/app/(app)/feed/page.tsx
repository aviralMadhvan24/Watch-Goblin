import type { Metadata } from "next";

import { ActivityFeed } from "@/components/feed/activity-feed";
import { EmptyState } from "@/components/shared/empty-state";
import { requireSession } from "@/server/auth/session";
import { getFollowingFeed } from "@/server/queries/social";

export const metadata: Metadata = { title: "Feed" };

export default async function FeedPage() {
  const session = await requireSession("/feed");
  const items = await getFollowingFeed(session.user.id, 60);

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight">Feed</h1>
        <p className="mt-1 text-sm text-ink-muted">
          What everyone you follow has been avoiding responsibilities for.
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          variant="feed"
          humor={session.user.humorEnabled}
          action={{ href: "/people" }}
        />
      ) : (
        <ActivityFeed items={items} />
      )}
    </div>
  );
}
