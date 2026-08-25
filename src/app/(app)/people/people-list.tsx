"use client";

import Link from "next/link";
import { useState } from "react";

import { FollowButton } from "@/components/social/follow-button";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";

export interface SuggestedPerson {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  accentColor: string | null;
  level: number;
  episodesWatched: number;
}

/**
 * Suggestion list, frozen on first render.
 *
 * `suggestedUsers` excludes people the viewer already follows, and *any*
 * `revalidatePath` inside a server action re-renders the route the action was
 * called from — so without this, following someone deletes their card mid-click
 * and slides a stranger into the same row, still reading "Follow". Snapshotting
 * the array into state keeps the row you clicked where you left it; the next
 * full page load fetches a fresh set.
 */
export function PeopleList({ initial }: { initial: SuggestedPerson[] }) {
  const [people] = useState(initial);

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {people.map((person) => (
        <li key={person.username}>
          <Card className="flex items-center gap-3 p-3">
            <Link href={`/u/${person.username}`} className="shrink-0">
              <Avatar
                src={person.avatarUrl}
                name={person.displayName}
                accentColor={person.accentColor}
              />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                href={`/u/${person.username}`}
                className="block truncate font-display text-sm font-semibold hover:text-primary"
              >
                {person.displayName}
              </Link>
              <p className="truncate text-xs text-ink-faint">
                Level {person.level} · {formatNumber(person.episodesWatched)} episodes
              </p>
            </div>
            <FollowButton
              username={person.username}
              initialFollowing={false}
              size="sm"
              refreshOnChange={false}
            />
          </Card>
        </li>
      ))}
    </ul>
  );
}
