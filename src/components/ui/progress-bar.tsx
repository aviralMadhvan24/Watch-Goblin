import { cn } from "@/lib/utils";
import { clamp } from "@/lib/utils";

export interface ProgressBarProps {
  value: number;
  max?: number;
  className?: string;
  /** Colour intent. `accent` (lime) is the reward colour — use it for real progress. */
  tone?: "accent" | "primary" | "success" | "danger" | "info" | "warning";
  size?: "xs" | "sm" | "md";
  /** Announced to screen readers, e.g. "Season 3 progress". */
  label?: string;
  /** Renders the ASCII-style block meter the product uses on profiles. */
  blocks?: boolean;
}

const TONE_CLASS = {
  accent: "bg-accent",
  primary: "bg-primary",
  success: "bg-success",
  danger: "bg-danger",
  info: "bg-info",
  warning: "bg-warning",
} as const;

const SIZE_CLASS = { xs: "h-1", sm: "h-1.5", md: "h-2.5" } as const;

const BLOCK_COUNT = 17;

/**
 * The single progress primitive. Every "x of y watched" bar in the app renders
 * through this, so a season bar, a show bar and the level bar always agree on
 * geometry and colour.
 */
export function ProgressBar({
  value,
  max = 100,
  className,
  tone = "accent",
  size = "sm",
  label,
  blocks = false,
}: ProgressBarProps) {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;

  if (blocks) {
    const filled = Math.round((pct / 100) * BLOCK_COUNT);
    return (
      <div
        className={cn("flex gap-[3px]", className)}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        {Array.from({ length: BLOCK_COUNT }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-2.5 flex-1 rounded-[2px] transition-colors duration-300",
              i < filled ? TONE_CLASS[tone] : "bg-surface-overlay",
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-full bg-surface-overlay",
        SIZE_CLASS[size],
        className,
      )}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", TONE_CLASS[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
