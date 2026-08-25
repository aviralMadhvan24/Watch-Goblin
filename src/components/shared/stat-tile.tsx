import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The number tile used across the dashboard, profiles and the stats page.
 * Values are pre-formatted by the caller — this component decides typography,
 * never units.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "default",
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "default" | "primary" | "accent" | "success";
  className?: string;
}) {
  const toneClass = {
    default: "text-ink",
    primary: "text-primary",
    accent: "text-accent",
    success: "text-success",
  }[tone];

  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
        {icon ? <span className="text-ink-faint">{icon}</span> : null}
      </div>
      <p className={cn("mt-2 font-display text-2xl font-bold tnum", toneClass)}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-faint">{hint}</p> : null}
    </Card>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>;
}

/** Section heading with an optional right-hand action. */
export function SectionHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-baseline justify-between gap-3", className)}>
      <h2 className="font-display text-lg font-semibold tracking-tight text-ink">{title}</h2>
      {action}
    </div>
  );
}
