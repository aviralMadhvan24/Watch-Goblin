import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { env, isProduction } from "@/config/env.server";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma client singleton.
 *
 * Next.js dev mode re-evaluates modules on every hot reload, which would open a
 * fresh connection pool each time and eventually exhaust Postgres. Stashing the
 * instance on `globalThis` keeps exactly one pool per process.
 */

declare global {
  // eslint-disable-next-line no-var
  var __watchgoblinPrisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: isProduction ? ["warn", "error"] : ["warn", "error"],
  });
}

export const db: PrismaClient = globalThis.__watchgoblinPrisma ?? createPrismaClient();

if (!isProduction) {
  globalThis.__watchgoblinPrisma = db;
}

/**
 * The type accepted by repository functions: either the shared client or an
 * interactive-transaction client. Services pass a transaction client down so a
 * whole unit of work (watch episode -> update caches -> award XP -> log
 * activity) commits or rolls back together.
 */
export type DbClient = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
