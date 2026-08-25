"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as React from "react";

import { cn } from "@/lib/utils";

const sizes = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-base",
  xl: "size-24 text-2xl",
} as const;

/**
 * Avatar with a deterministic initial fallback. The fallback is not decorative:
 * most users never upload an image, so the "empty" case is the common case and
 * has to look intentional.
 */
export function Avatar({
  src,
  name,
  size = "md",
  accentColor,
  className,
}: {
  src?: string | null;
  name: string;
  size?: keyof typeof sizes;
  /** Tints the fallback so a profile still feels personalised without a photo. */
  accentColor?: string | null;
  className?: string;
}) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative flex shrink-0 overflow-hidden rounded-full border border-line",
        sizes[size],
        className,
      )}
    >
      {src ? (
        <AvatarPrimitive.Image
          src={src}
          alt=""
          className="size-full object-cover"
        />
      ) : null}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className="flex size-full items-center justify-center font-display font-semibold uppercase text-ink"
        style={accentColor ? { backgroundColor: `${accentColor}33`, color: accentColor } : undefined}
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2);
  return (parts[0]![0]! + parts[1]![0]!).slice(0, 2);
}
