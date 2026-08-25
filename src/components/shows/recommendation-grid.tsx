import { Sparkles } from "lucide-react";

import { ShowCard, ShowGrid } from "@/components/shows/show-card";
import type { Recommendation } from "@/server/queries/recommendations";

/**
 * Recommendation shelf.
 *
 * Every tile carries its reason. That is not decoration: a suggestion with no
 * stated basis is indistinguishable from a random one, so users discount the
 * whole shelf. Saying "because you watched Frieren" makes the claim checkable,
 * and a wrong reason is more useful feedback than a silent bad guess.
 */
export function RecommendationGrid({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) return null;

  return (
    <ShowGrid>
      {recommendations.map((rec) => (
        <ShowCard
          key={rec.show.id}
          show={rec.show}
          footer={
            <span className="mt-0.5 flex items-start gap-1 text-xs leading-snug text-ink-faint">
              <Sparkles aria-hidden className="mt-0.5 size-3 shrink-0 text-primary/70" />
              {/* Clamped rather than truncated: a long show title in the reason
                  should wrap to a second line, not vanish behind an ellipsis. */}
              <span className="line-clamp-2">{rec.reason}</span>
            </span>
          }
        />
      ))}
    </ShowGrid>
  );
}
