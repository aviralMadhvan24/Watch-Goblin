import Link from "next/link";
import { redirect } from "next/navigation";
import { Flame, Swords, Trophy, TvMinimalPlay } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { brand } from "@/config/brand";
import { getOptionalSession } from "@/server/auth/session";

export default async function LandingPage() {
  // Signed-in visitors have no use for the pitch.
  const session = await getOptionalSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6">
        <span className="font-display text-lg font-bold tracking-tight">
          <span aria-hidden>{brand.mascot}</span> {brand.name}
        </span>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/register">Start tracking</Link>
          </Button>
        </nav>
      </header>

      <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-10 sm:pt-16">
        <Badge variant="accent" size="sm" className="mb-5">
          <Flame className="size-3" /> Episode-level tracking
        </Badge>

        <h1 className="max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight text-balance sm:text-6xl">
          You have watched{" "}
          <span className="text-primary">thousands of episodes</span> and can name
          maybe nine.
        </h1>

        <p className="mt-5 max-w-xl text-base text-ink-muted text-pretty sm:text-lg">
          {brand.description}
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" asChild>
            <Link href="/register">Make an account</Link>
          </Button>
          <Button size="lg" variant="secondary" asChild>
            <Link href="/discover">Look around first</Link>
          </Button>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={<TvMinimalPlay className="size-5 text-info" />}
            title="Track the actual episode"
            body="Not &ldquo;watched&rdquo;. S04E11, timestamped, with the season bar to prove it."
          >
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-ink-faint">
                <span>Season 4</span>
                <span className="tnum">11 / 16</span>
              </div>
              <ProgressBar value={11} max={16} />
            </div>
          </FeatureCard>

          <FeatureCard
            icon={<Trophy className="size-5 text-accent" />}
            title="Ranks you cannot brag about"
            body="Earn XP, level up, and become a Certified Screen Goblin. Nobody is impressed."
          >
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-ink-faint">
                <span>Level 27</span>
                <span className="tnum">82%</span>
              </div>
              <ProgressBar value={82} blocks />
            </div>
          </FeatureCard>

          <FeatureCard
            icon={<Swords className="size-5 text-danger" />}
            title="Beat your friends at nothing"
            body="Leaderboards for shows, episodes, hours and streaks. Someone has to be last."
            className="sm:col-span-2 lg:col-span-1"
          >
            <ol className="space-y-1.5 text-sm">
              {[
                ["🥇", "@showdestroyer", "847"],
                ["🥈", "@netflixcriminal", "712"],
                ["🥉", "@hikikomori", "691"],
              ].map(([medal, handle, count]) => (
                <li key={handle} className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink-muted">
                    <span aria-hidden>{medal}</span> {handle}
                  </span>
                  <span className="tnum font-mono text-xs text-ink">{count}</span>
                </li>
              ))}
            </ol>
          </FeatureCard>
        </div>
      </section>

      <footer className="mt-auto border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-6 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <span>
            {brand.name} — {brand.tagline}
          </span>
          <span>Built for people whose watch history is a personality.</span>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  body,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex size-10 items-center justify-center rounded-xl bg-surface-overlay">
          {icon}
        </div>
        <div>
          <h2 className="font-display text-base font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-ink-muted text-pretty">{body}</p>
        </div>
        {children ? <div className="mt-1">{children}</div> : null}
      </div>
    </Card>
  );
}
