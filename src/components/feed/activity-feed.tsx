import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { formatEpisodeCode, formatRelativeTime } from "@/lib/format";
import type { FeedItem } from "@/server/queries/social";

/**
 * The activity feed.
 *
 * Display text comes from `Activity.payload`, which the activity service
 * denormalises at write time — rendering 50 items therefore costs no extra
 * joins. That also means an item stays readable after the show it referenced
 * is renamed, which is the behaviour people expect from a log.
 */
export function ActivityFeed({ items }: { items: FeedItem[] }) {
  return (
    <ul className="divide-y divide-line rounded-card border border-line">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 px-4 py-3">
          <Link href={`/u/${item.actor.username}`} className="shrink-0">
            <Avatar
              src={item.actor.avatarUrl}
              name={item.actor.displayName}
              accentColor={item.actor.accentColor}
              size="sm"
            />
          </Link>

          <div className="min-w-0 flex-1">
            <p className="text-sm leading-snug text-ink-muted">
              <Link
                href={`/u/${item.actor.username}`}
                className="font-medium text-ink hover:text-primary"
              >
                {item.actor.displayName}
              </Link>{" "}
              {describe(item)}
            </p>
            <p className="mt-0.5 text-xs text-ink-faint">{formatRelativeTime(item.createdAt)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Renders the sentence for one activity type. */
function describe(item: FeedItem): React.ReactNode {
  const show = item.show ? (
    <Link href={`/shows/${item.show.slug}`} className="font-medium text-ink hover:text-primary">
      {item.show.title}
    </Link>
  ) : (
    <span className="text-ink">a show</span>
  );

  const seasonNumber = numberField(item.payload.seasonNumber);
  const episodeNumber = numberField(item.payload.episodeNumber);

  switch (item.type) {
    case "EPISODE_WATCHED":
      return (
        <>
          watched{" "}
          {seasonNumber !== null && episodeNumber !== null ? (
            <span className="tnum font-mono text-xs text-ink">
              {formatEpisodeCode(seasonNumber, episodeNumber)}
            </span>
          ) : (
            "an episode"
          )}{" "}
          of {show}
        </>
      );
    case "SHOW_COMPLETED":
      return <>finished {show}</>;
    case "SEASON_COMPLETED":
      return (
        <>
          finished season <span className="tnum">{seasonNumber ?? "?"}</span> of {show}
        </>
      );
    case "SHOW_ADDED":
      return <>added {show} to their library</>;
    case "STATUS_CHANGED":
      return <>updated {show}</>;
    case "SHOW_RATED":
      return (
        <>
          rated {show} <span className="tnum text-accent">{numberField(item.payload.rating) ?? "?"}★</span>
        </>
      );
    case "REVIEW_POSTED":
      return <>reviewed {show}</>;
    case "USER_FOLLOWED":
      return item.targetUsername ? (
        <>
          followed{" "}
          <Link
            href={`/u/${item.targetUsername}`}
            className="font-medium text-ink hover:text-primary"
          >
            @{item.targetUsername}
          </Link>
        </>
      ) : (
        <>followed someone</>
      );
    case "ACHIEVEMENT_UNLOCKED":
      return item.achievement ? (
        <>
          unlocked <span aria-hidden>{item.achievement.icon}</span>{" "}
          <span className="font-medium text-accent">{item.achievement.name}</span>
        </>
      ) : (
        <>unlocked an achievement</>
      );
    case "LEVEL_UP":
      return (
        <>
          reached level{" "}
          <span className="tnum font-medium text-primary">
            {numberField(item.payload.level) ?? "?"}
          </span>
        </>
      );
    case "STREAK_MILESTONE":
      return (
        <>
          hit a{" "}
          <span className="tnum font-medium text-success">
            {numberField(item.payload.streak) ?? "?"}-day
          </span>{" "}
          streak
        </>
      );
    default:
      return <>did something</>;
  }
}

/** `payload` is untyped JSON, so every read out of it is guarded. */
function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
