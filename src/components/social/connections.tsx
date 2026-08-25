import Link from "next/link";
import { notFound } from "next/navigation";

import { SimpleEmpty } from "@/components/shared/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getOptionalSession } from "@/server/auth/session";
import { getProfile, listFollowers, listFollowing } from "@/server/queries/social";

/**
 * Shared body for `/u/:username/followers` and `/u/:username/following`.
 *
 * They are two routes rather than one optional catch-all because an optional
 * catch-all also matches the bare `/u/:username`, which would collide with the
 * profile page itself.
 */
export async function Connections({
  username,
  tab,
}: {
  username: string;
  tab: "followers" | "following";
}) {
  const session = await getOptionalSession();
  const profile = await getProfile(username, session?.user.id ?? null);
  if (!profile) notFound();

  // The same gate as the profile: a private account does not leak its social
  // graph through a sibling route.
  if (!profile.visible) {
    return (
      <div className="mx-auto w-full max-w-2xl px-5 py-8">
        <SimpleEmpty
          title="This profile is private"
          body="Only people they follow can see who they follow."
        />
      </div>
    );
  }

  const people =
    tab === "followers" ? await listFollowers(profile.id) : await listFollowing(profile.id);

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8">
      <header className="mb-5">
        <Link href={`/u/${profile.username}`} className="text-sm text-ink-muted hover:text-primary">
          ← {profile.displayName}
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold capitalize tracking-tight">{tab}</h1>
      </header>

      <nav className="mb-5 flex gap-1.5">
        {(["followers", "following"] as const).map((value) => (
          <Link
            key={value}
            href={`/u/${profile.username}/${value}`}
            aria-current={tab === value ? "page" : undefined}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-medium capitalize transition-colors",
              tab === value
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-line bg-surface-raised text-ink-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {value}
          </Link>
        ))}
      </nav>

      {people.length === 0 ? (
        <SimpleEmpty
          title={tab === "followers" ? "Nobody is watching them" : "They follow nobody"}
          body="Yet."
        />
      ) : (
        <ul className="grid gap-2">
          {people.map((person) => (
            <li key={person.username}>
              <Link href={`/u/${person.username}`}>
                <Card interactive className="flex items-center gap-3 p-3">
                  <Avatar
                    src={person.avatarUrl}
                    name={person.displayName}
                    accentColor={person.accentColor}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{person.displayName}</p>
                    <p className="truncate text-xs text-ink-faint">@{person.username}</p>
                  </div>
                  <span className="tnum shrink-0 text-xs text-ink-faint">Level {person.level}</span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
