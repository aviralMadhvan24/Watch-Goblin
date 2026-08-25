import type { Metadata } from "next";

import { SectionHeader } from "@/components/shared/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { db } from "@/db/client";
import type { AchievementCategory } from "@/generated/prisma/enums";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireSession } from "@/server/auth/session";
import { achievementsService } from "@/server/services/achievements.service";

export const metadata: Metadata = { title: "Achievements" };

const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  MILESTONE: "Milestones",
  BINGE: "Binging",
  STREAK: "Streaks",
  ANIME: "Anime",
  TV: "TV",
  SOCIAL: "Social",
  SPECIAL: "Special",
};

const CATEGORY_ORDER: AchievementCategory[] = [
  "MILESTONE",
  "BINGE",
  "STREAK",
  "ANIME",
  "TV",
  "SOCIAL",
  "SPECIAL",
];

export default async function AchievementsPage() {
  const session = await requireSession("/achievements");
  const achievements = await achievementsService.listProgressForUser(db, session.user.id);

  const unlocked = achievements.filter((a) => a.unlockedAt !== null).length;

  const byCategory = new Map<AchievementCategory, typeof achievements>();
  for (const achievement of achievements) {
    const list = byCategory.get(achievement.category) ?? [];
    list.push(achievement);
    byCategory.set(achievement.category, list);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Achievements</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {unlocked} of {achievements.length} unlocked. The bar is on the floor.
        </p>
        <div className="mt-3 max-w-sm">
          <ProgressBar value={unlocked} max={achievements.length || 1} tone="accent" />
        </div>
      </header>

      <div className="space-y-8">
        {CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => (
          <section key={category}>
            <SectionHeader title={CATEGORY_LABELS[category]} />
            <div className="grid gap-3 sm:grid-cols-2">
              {byCategory.get(category)!.map((achievement) => {
                const isUnlocked = achievement.unlockedAt !== null;
                return (
                  <Card
                    key={achievement.id}
                    className={cn(
                      "flex gap-3 p-4",
                      isUnlocked ? "border-accent/30 bg-accent/5" : "opacity-80",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn("text-2xl", !isUnlocked && "opacity-40 grayscale")}
                    >
                      {achievement.icon}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-display text-sm font-semibold text-ink">
                          {achievement.name}
                        </p>
                        {achievement.xpReward > 0 ? (
                          <Badge variant={isUnlocked ? "accent" : "neutral"} size="sm">
                            +{achievement.xpReward} XP
                          </Badge>
                        ) : null}
                      </div>

                      <p className="mt-0.5 text-xs text-ink-muted">{achievement.description}</p>

                      {isUnlocked ? (
                        <p className="mt-2 text-xs font-medium text-success">Unlocked</p>
                      ) : (
                        <div className="mt-2 space-y-1">
                          <ProgressBar value={achievement.progress * 100} />
                          <p className="tnum text-xs text-ink-faint">
                            {formatNumber(achievement.value)} / {formatNumber(achievement.threshold)}
                          </p>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
