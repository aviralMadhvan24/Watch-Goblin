"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Discover filter bar.
 *
 * Filters live in the URL rather than component state: that makes a filtered
 * view shareable, survivable across a refresh, and re-fetched by the server
 * component rather than duplicated as a client-side query.
 */

const TYPES = [
  { value: "", label: "All" },
  { value: "ANIME", label: "Anime" },
  { value: "TV", label: "TV" },
] as const;

const SORTS = [
  { value: "popular", label: "Popular" },
  { value: "rating", label: "Top rated" },
  { value: "members", label: "Most watched" },
  { value: "newest", label: "Newest" },
  { value: "title", label: "A–Z" },
] as const;

export function DiscoverFiltersBar({
  genres,
  current,
}: {
  genres: { slug: string; name: string }[];
  current: { q?: string; type?: string; genre?: string; airing?: string; sort?: string };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // Any filter change invalidates the current page number.
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.push(qs ? `/discover?${qs}` : "/discover"));
  }

  const hasFilters = Boolean(current.q || current.type || current.genre || current.airing);

  return (
    <div className={cn("space-y-3", pending && "opacity-70")}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("q");
          apply({ q: (typeof value === "string" && value.trim()) || undefined });
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          {/* Uncontrolled, keyed on the URL term: the box resets when the query
              changes from elsewhere (back button, "clear") without an effect
              that writes state during render. */}
          <Input
            key={current.q ?? ""}
            name="q"
            defaultValue={current.q ?? ""}
            placeholder="Search shows…"
            aria-label="Search shows"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterGroup label="Type">
          {TYPES.map((option) => (
            <Chip
              key={option.value || "all"}
              active={(current.type ?? "") === option.value}
              onClick={() => apply({ type: option.value || undefined })}
            >
              {option.label}
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Sort">
          {SORTS.map((option) => (
            <Chip
              key={option.value}
              active={(current.sort ?? "popular") === option.value}
              onClick={() => apply({ sort: option.value === "popular" ? undefined : option.value })}
            >
              {option.label}
            </Chip>
          ))}
        </FilterGroup>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
          Genre
        </span>
        {genres.map((genre) => (
          <Chip
            key={genre.slug}
            active={current.genre === genre.slug}
            onClick={() =>
              apply({ genre: current.genre === genre.slug ? undefined : genre.slug })
            }
          >
            {genre.name}
          </Chip>
        ))}
      </div>

      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={() => router.push("/discover")}>
          <X /> Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-line bg-surface-raised text-ink-muted hover:border-line-strong hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
