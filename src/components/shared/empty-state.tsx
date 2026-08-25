import Link from "next/link";

import { Button } from "@/components/ui/button";
import { copy, type EmptyStateKey } from "@/config/brand";
import { cn } from "@/lib/utils";

/**
 * Empty states.
 *
 * The joke lives here because this is where the product's voice belongs — see
 * the note in `config/brand.ts`. `humorEnabled: false` swaps in the plain copy,
 * so the toggle is honoured by every empty state without each caller checking.
 */
export function EmptyState({
  variant,
  humor = true,
  action,
  className,
}: {
  variant: EmptyStateKey;
  humor?: boolean;
  action?: { href: string; label?: string };
  className?: string;
}) {
  const funny = copy.empty[variant];
  const plain = copy.plain.empty[variant];
  const { title, body } = humor ? funny : plain;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-card border border-dashed border-line px-6 py-14 text-center",
        className,
      )}
    >
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {body ? <p className="mt-1.5 max-w-sm text-sm text-ink-muted">{body}</p> : null}
      {action ? (
        <Button asChild size="sm" variant="secondary" className="mt-5">
          <Link href={action.href}>{action.label ?? funny.cta}</Link>
        </Button>
      ) : null}
    </div>
  );
}

/** Generic version for one-off empties that have no entry in the copy deck. */
export function SimpleEmpty({
  title,
  body,
  className,
}: {
  title: string;
  body?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-dashed border-line px-6 py-12 text-center",
        className,
      )}
    >
      <p className="font-display text-sm font-semibold text-ink">{title}</p>
      {body ? <p className="mt-1 text-sm text-ink-muted">{body}</p> : null}
    </div>
  );
}
