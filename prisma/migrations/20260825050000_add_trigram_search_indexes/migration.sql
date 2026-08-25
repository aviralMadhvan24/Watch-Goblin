-- Trigram indexes for catalogue search.
--
-- `discoverShows` and the library filter both search with
-- `contains` + `mode: "insensitive"`, which Prisma compiles to `ILIKE '%q%'`.
-- A leading wildcard makes that unservable by the existing btree on
-- `shows.title`, so every search was a sequential scan over the whole
-- catalogue. That is invisible at a few dozen rows and painful at a hundred
-- thousand.
--
-- `gin_trgm_ops` is the operator class that *can* answer a double-ended
-- wildcard: it indexes every three-character substring, so `ILIKE '%rien%'`
-- becomes an index lookup on the trigrams of the pattern. It also makes
-- similarity ranking available later without another migration.
--
-- Written by hand rather than generated: the extension and the operator class
-- have no representation in `schema.prisma` without the `postgresqlExtensions`
-- preview flag, and this is a pure index change with no model to describe.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "shows_title_trgm_idx"
  ON "shows" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "shows_original_title_trgm_idx"
  ON "shows" USING GIN ("originalTitle" gin_trgm_ops);
