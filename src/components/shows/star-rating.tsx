"use client";

import { Star } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Half-star rating control, matching the service rule of 0.5-steps from 0.5 to
 * 5. Each star is two buttons wide (left half / right half) rather than a
 * slider, because a slider makes "exactly 3.5" hard to hit on a phone.
 */
export function StarRating({
  value,
  onChange,
  readOnly = false,
  size = "md",
}: {
  value: number | null;
  onChange?: (rating: number | null) => void;
  readOnly?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  const starSize = { sm: "size-3.5", md: "size-5", lg: "size-7" }[size];

  if (readOnly) {
    return (
      <div className="flex items-center gap-0.5" aria-label={`${value ?? 0} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((index) => (
          <StarIcon key={index} index={index} shown={shown} className={starSize} />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-0.5"
      onMouseLeave={() => setHover(null)}
      role="group"
      aria-label="Rate this show"
    >
      {[1, 2, 3, 4, 5].map((index) => (
        <span key={index} className="relative inline-flex">
          <StarIcon index={index} shown={shown} className={starSize} />
          {/* Two invisible hit targets stacked over each star: left = half. */}
          {[index - 0.5, index].map((rating) => (
            <button
              key={rating}
              type="button"
              aria-label={`${rating} star${rating === 1 ? "" : "s"}`}
              onMouseEnter={() => setHover(rating)}
              onClick={() => onChange?.(value === rating ? null : rating)}
              className={cn(
                "absolute inset-y-0 w-1/2 cursor-pointer",
                rating === index ? "right-0" : "left-0",
              )}
            />
          ))}
        </span>
      ))}
    </div>
  );
}

/**
 * One star, filled 0%, 50% or 100%. The half state is a clipped overlay rather
 * than a separate icon so both halves stay pixel-aligned at every size.
 */
function StarIcon({
  index,
  shown,
  className,
}: {
  index: number;
  shown: number;
  className: string;
}) {
  const filled = shown >= index;
  const half = !filled && shown >= index - 0.5;

  return (
    <span className="relative inline-flex">
      <Star className={cn(className, "text-line-strong")} />
      {filled || half ? (
        <span
          className="absolute inset-0 overflow-hidden"
          style={half ? { width: "50%" } : undefined}
        >
          <Star className={cn(className, "fill-accent text-accent")} />
        </span>
      ) : null}
    </span>
  );
}
