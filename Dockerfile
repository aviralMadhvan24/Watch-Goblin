# syntax=docker/dockerfile:1
# The only "secret"-looking value below is a build-time placeholder that is
# overwritten by the real environment at runtime; see the comment above it.
# check=skip=SecretsUsedInArgOrEnv

# WatchGoblin production image.
#
# Three stages so the runtime carries none of the build toolchain: `deps` holds
# the full dependency tree, `builder` compiles, and `runner` copies only the
# standalone output plus what a release actually needs.
#
# Prisma 7 talks to Postgres through the `pg` driver adapter, so there is no
# query-engine binary to match against the base image — the client is plain
# JavaScript and traces into the standalone bundle like anything else.

# --- deps --------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app

# Only the manifests, so this layer is cached until a dependency actually
# changes — the rest of the source churns far more often than the lockfile.
COPY package.json package-lock.json ./
RUN npm ci

# --- builder -----------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `src/generated/prisma` is gitignored, so the client has to be generated here.
# `npm run build` already does this, but running it explicitly keeps the failure
# legible when the schema is the thing that broke.
RUN npx prisma generate

# `env.server` parses process.env at import time and `next build` imports the
# app to collect route data, so the build needs values present. These are
# placeholders that exist only inside this layer — both are read again at
# runtime from the real environment, and nothing here is contacted during the
# build. AUTH_SECRET must clear the 32-character minimum to parse.
#
# The production-only rules in `env.server` (real email transport, rate limiting
# on) are skipped during the build phase, so there is nothing to fake for them.
ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV AUTH_SECRET=build-time-placeholder-secret-not-used-at-runtime
ENV NEXT_TELEMETRY_DISABLED=1

RUN npx next build

# --- migrator ----------------------------------------------------------------
# Schema changes, as a separate image:
#
#   docker build --target migrator -t watchgoblin-migrate .
#   docker run --rm -e DATABASE_URL=... watchgoblin-migrate
#
# A stage of its own rather than a command against the runtime image, because
# the Prisma CLI needs the dependency tree it was installed with: @prisma/config
# reaches for `effect` and others, so copying only `prisma` and `@prisma` into
# the standalone tree produces a CLI that cannot start. Keeping them apart also
# means the app image carries no migration toolchain it must never run.
FROM node:24-alpine AS migrator
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma

USER node

CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

# --- runner ------------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Never root. `node` already exists in the base image with uid 1000.
RUN mkdir -p /app/public/uploads && chown -R node:node /app

# `public` and `.next/static` are deliberately excluded from the standalone
# output, on the assumption they are fronted by a CDN. There is no CDN here, so
# they are copied in and `server.js` serves them.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Migrations are deliberately absent from this image and from this container's
# start-up. With more than one replica, migrating on boot means every container
# racing on every deploy — `migrate deploy` takes an advisory lock so it would
# not corrupt anything, but a schema change belongs in a release step, not a
# boot path. Use the `migrator` target at the bottom of this file instead.

USER node
EXPOSE 3000

# Hits the readiness probe, which proves this instance can reach the database —
# see the comment in src/app/api/health/route.ts for why that is the right check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
