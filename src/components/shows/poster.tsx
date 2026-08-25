import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * Show poster with a generated fallback.
 *
 * The catalogue ships with no artwork, so the fallback is the common case, not
 * the exception — it gets a deterministic hue derived from the title so a grid
 * of shows still reads as distinct tiles rather than a wall of grey boxes.
 */

const sizes = {
  sm: "w-16",
  md: "w-full",
} as const;

export function Poster({
  src,
  title,
  className,
  size = "md",
}: {
  src?: string | null;
  title: string;
  className?: string;
  size?: keyof typeof sizes;
}) {
  const hue = hueFor(title);

  return (
    <div
      className={cn(
        "relative aspect-[2/3] shrink-0 overflow-hidden rounded-poster border border-line bg-surface-raised",
        sizes[size],
        className,
      )}
    >
      {src ? (
        <Image
          src={src}
          alt=""
          fill
          // A poster grid is six-up on desktop and three-up on phones, so the
          // optimiser is told the real rendered width rather than serving a
          // full-width image into a 150px slot.
          sizes={size === "sm" ? "64px" : "(min-width: 1024px) 180px, (min-width: 640px) 25vw, 33vw"}
          className="object-cover"
        />
      ) : (
        <div
          className="flex size-full items-center justify-center p-2"
          style={{
            background: `linear-gradient(150deg, hsl(${hue} 55% 22%), hsl(${(hue + 40) % 360} 45% 12%))`,
          }}
        >
          <span
            aria-hidden
            className="font-display text-2xl font-bold opacity-70"
            style={{ color: `hsl(${hue} 70% 78%)` }}
          >
            {initial(title)}
          </span>
        </div>
      )}
    </div>
  );
}

/** Stable per-title hue: the same show is always the same colour. */
function hueFor(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = (hash * 31 + title.charCodeAt(i)) % 360;
  }
  return hash;
}

function initial(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
