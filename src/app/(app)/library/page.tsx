import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { STATUS_LABELS, STATUS_ORDER, StatusDot } from "@/components/shared/status";
import { ShowCard, ShowGrid } from "@/components/shows/show-card";
import type { ShowType, WatchStatus } from "@/generated/prisma/enums";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireSession } from "@/server/auth/session";
import { getLibrary, getLibraryCounts, type LibrarySort } from "@/server/queries/library";

export const metadata: Metadata = { title: "Library" };

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: "recent", label: "Recently watched" },
  { value: "added", label: "Recently added" },
  { value: "progress", label: "Most progress" },
  { value: "rating", label: "Your rating" },
  { value: "title", label: "A–Z" },
];

const STATUSES = new Set<string>(STATUS_ORDER);
const TYPES = new Set<string>(["ANIME", "TV"]);
const SORT_VALUES = new Set<string>(SORTS.map((s) => s.value));

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LibraryPage({ searchParams }: PageProps<"/library">) {
  const session = await requireSession("/library");
  const params = await searchParams;

  const rawStatus = one(params.status);
  const status = rawStatus && STATUSES.has(rawStatus) ? (rawStatus as WatchStatus) : undefined;
  const rawType = one(params.type);
  const type = rawType && TYPES.has(rawType) ? (rawType as ShowType) : undefined;
  const rawSort = one(params.sort);
  const sort = rawSort && SORT_VALUES.has(rawSort) ? (rawSort as LibrarySort) : "recent";

  const [entries, counts] = await Promise.all([
    getLibrary(session.user.id, { status, type, sort }),
    getLibraryCounts(session.user.id),
  ]);

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  /** Builds a URL that changes one facet and leaves the rest intact. */
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { status: rawStatus, type: rawType, sort: rawSort, ...patch };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const qs = next.toString();
    return qs ? `/library?${qs}` : "/library";
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight">Your library</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {formatNumber(total)} {total === 1 ? "show" : "shows"} tracked.
        </p>
      </header>

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Filter by status">
        <Tab href={href({ status: undefined })} active={!status} label="All" count={total} />
        {STATUS_ORDER.map((value) => (
          <Tab
            key={value}
            href={href({ status: value })}
            active={status === value}
            label={STATUS_LABELS[value]}
            count={counts[value]}
            dot={<StatusDot status={value} />}
          />
        ))}
      </nav>

      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="uppercase tracking-wide text-ink-faint">Type</span>
          <Pill href={href({ type: undefined })} active={!type} label="All" />
          <Pill href={href({ type: "ANIME" })} active={type === "ANIME"} label="Anime" />
          <Pill href={href({ type: "TV" })} active={type === "TV"} label="TV" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="uppercase tracking-wide text-ink-faint">Sort</span>
          {SORTS.map((option) => (
            <Pill
              key={option.value}
              href={href({ sort: option.value })}
              active={sort === option.value}
              label={option.label}
            />
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          variant={status === "PLAN_TO_WATCH" ? "watchlist" : "library"}
          humor={session.user.humorEnabled}
          action={{ href: "/discover" }}
        />
      ) : (
        <ShowGrid>
          {entries.map((entry) => (
            <ShowCard
              key={entry.id}
              show={{
                slug: entry.show.slug,
                title: entry.show.title,
                posterUrl: entry.show.posterUrl,
                type: entry.show.type,
                totalEpisodes: entry.show.totalEpisodes,
              }}
              progress={entry.progress}
              footer={
                <p className="tnum mt-0.5 text-xs text-ink-faint">
                  {entry.episodesWatched} / {entry.show.totalEpisodes}
                  {entry.rating ? ` · ${entry.rating}★` : ""}
                </p>
              }
            />
          ))}
        </ShowGrid>
      )}
    </div>
  );
}

function Tab({
  href,
  active,
  label,
  count,
  dot,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
  dot?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-line bg-surface-raised text-ink-muted hover:border-line-strong hover:text-ink",
      )}
    >
      {dot}
      {label}
      <span className="tnum text-xs opacity-60">{count}</span>
    </Link>
  );
}

function Pill({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md px-2 py-1 font-medium transition-colors",
        active ? "bg-surface-overlay text-ink" : "text-ink-muted hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}
