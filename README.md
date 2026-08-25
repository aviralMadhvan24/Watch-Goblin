# WatchGoblin

Track anime and TV down to the episode, then flex the damage.

A watch tracker built on Next.js 16 and Postgres. Mark episodes, watch your
progress and streaks build, earn XP and levels, write reviews, follow people,
and climb a leaderboard.

## How it works

The design worth knowing about, because everything else follows from it:

**`UserEpisode` rows are the only facts.** Every other number — episodes
watched, seasons completed, minutes, progress percentage, watch status — is a
cache derived from them and recomputed on every change. That is why undo works
correctly, why nothing drifts, and why `statsService.recompute` can always
rebuild a user's counters from scratch if it ever does.

**The client never sends numbers.** It sends "I watched episode X". Counts, XP,
levels, streaks and completion are all resolved server-side, because every one
of them is something it would be worth lying about.

**XP is a ledger, not a counter.** Each award is an immutable row with a stable
dedupe key and a unique index behind it, so un-watching and re-watching an
episode pays nothing the second time. XP is never revoked — it records what you
did.

**Catalogue metadata sits behind a provider interface.** Nothing above
`MetadataProvider` knows the data came from TMDB. Shows are identified by
`(sourceProvider, sourceId)`, so importing the same show twice updates it in
place and existing watch history survives.

## Getting started

Requires Node 20+ and Docker.

```bash
npm install
cp .env.example .env        # then fill in AUTH_SECRET and, optionally, TMDB_API_KEY
npm run db:up               # Postgres on :5442
npm run db:migrate
npm run db:seed
npm run dev
```

`METADATA_PROVIDER=local` serves the seeded catalogue and needs no API key. Set
it to `tmdb` with a `TMDB_API_KEY` to search and import real shows.

### Filling the catalogue

```bash
npm run import:tmdb -- --limit 1000    # ~2k shows: 1000 anime + 1000 TV
npm run import:tmdb -- --query "one piece"
npm run import:tmdb -- --refresh       # re-fetch shows already held
```

Shows already in the catalogue are skipped, so an interrupted run resumes rather
than starting over.

Beyond the bulk import, the app fetches on demand: a search that the local
catalogue cannot satisfy asks the provider, and a show is only written to the
database when someone actually opens it.

## Testing

```bash
npm run verify              # typecheck + lint + unit tests
npm run test:db:setup       # one-off: creates and migrates the test database
npm run test:integration    # real Postgres, no mocks
```

Unit tests cover the pure logic — the level curve, date arithmetic, slugs,
cursors, the rate limiter, the TMDB provider's classification and content
filters. Integration tests cover the parts that are *defined* by their
interaction with the database: import idempotency, progress derivation, XP
deduping, and a check that the incremental counters agree with a full recompute.

## Deployment

```bash
docker compose --env-file .env.docker -f docker-compose.prod.yml up -d --build
```

Two app instances behind nginx, one Postgres, and Mailpit catching outbound
mail at <http://localhost:8025>. Two instances on purpose: everything that
breaks under horizontal scaling breaks at exactly two, so it surfaces locally
instead of on a deploy.

Migrations run as a one-shot service that the app instances wait for, built
from the `migrator` stage — a schema change belongs in a release step, not a
boot path where every replica races it.

Production refuses to start misconfigured: no console email provider, no
disabled rate limiting. Run more than one instance and you want
`RATE_LIMIT_DRIVER=postgres`, or each container keeps its own budget and every
limit multiplies by the fleet size.

## Layout

```
src/app/            routes (App Router)
src/components/     UI, design system in components/ui
src/features/       server actions, grouped by feature
src/server/
  auth/             session resolution, cookies
  queries/          reads — safe to call from a server component
  services/         writes and business logic
  integrations/     metadata, storage, email — each behind an interface
src/lib/            pure helpers, no I/O
src/config/         tunable constants: XP economy, ranks, achievements, env
prisma/             schema, migrations, seed
tests/              unit and integration
```

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run verify` | Typecheck, lint, unit tests |
| `npm run db:migrate` / `db:seed` / `db:studio` | Schema, fixtures, browser |
| `npm run import:tmdb` | Fill the catalogue from TMDB |
| `npm run stats:recompute` | Rebuild user counters from the underlying facts |
