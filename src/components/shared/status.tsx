import { Badge } from "@/components/ui/badge";
import type { WatchStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * Watch-status vocabulary in one place. The labels are read by the library
 * tabs, the status picker and every card that shows a badge, so a rename
 * happens once rather than in six components.
 */

export const STATUS_LABELS: Record<WatchStatus, string> = {
  WATCHING: "Watching",
  COMPLETED: "Completed",
  PLAN_TO_WATCH: "Plan to watch",
  ON_HOLD: "On hold",
  DROPPED: "Dropped",
  REWATCHING: "Rewatching",
};

/** Order the statuses are presented in — roughly the lifecycle of a show. */
export const STATUS_ORDER: WatchStatus[] = [
  "WATCHING",
  "COMPLETED",
  "PLAN_TO_WATCH",
  "REWATCHING",
  "ON_HOLD",
  "DROPPED",
];

const STATUS_DOT: Record<WatchStatus, string> = {
  WATCHING: "bg-status-watching",
  COMPLETED: "bg-status-completed",
  PLAN_TO_WATCH: "bg-status-plan",
  ON_HOLD: "bg-status-hold",
  DROPPED: "bg-status-dropped",
  REWATCHING: "bg-status-rewatching",
};

export function StatusBadge({ status, className }: { status: WatchStatus; className?: string }) {
  return (
    <Badge variant="outline" size="sm" className={cn("gap-1.5", className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function StatusDot({ status }: { status: WatchStatus }) {
  return <span aria-hidden className={cn("size-2 rounded-full", STATUS_DOT[status])} />;
}
