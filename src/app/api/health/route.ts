import { db } from "@/db/client";
import { logger } from "@/lib/logger";

/**
 * Readiness probe for the load balancer.
 *
 * This is a *readiness* check, not a liveness check: it reports whether this
 * instance can actually serve a request, which means proving the database is
 * reachable rather than just that the process is up. An instance whose pool is
 * exhausted or whose DATABASE_URL is wrong would happily answer a bare
 * `return 200` while failing every real page, and nginx would keep sending it
 * traffic.
 *
 * Route Handlers are uncached by default in Next 16, so this runs per request.
 * The explicit `no-store` stops any intermediate proxy from answering on our
 * behalf with a stale "healthy".
 */

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
  "content-type": "application/json",
} as const;

export async function GET() {
  const startedAt = Date.now();

  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    // Logged at warn, not error: during a rolling start this fires a few times
    // before Postgres accepts connections, and that is expected, not a fault.
    logger.warn("Health check failed: database unreachable", {
      error: String(error),
    });

    return new Response(
      JSON.stringify({ status: "unhealthy", database: "down" }),
      { status: 503, headers: NO_STORE },
    );
  }

  return new Response(
    JSON.stringify({
      status: "ok",
      database: "up",
      // Which container answered. Makes it trivial to confirm the load
      // balancer is actually spreading traffic: curl it in a loop and watch
      // this value change.
      instance: process.env.INSTANCE_ID ?? process.env.HOSTNAME ?? "unknown",
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - startedAt,
    }),
    { status: 200, headers: NO_STORE },
  );
}

/** nginx and Docker health probes often use HEAD; answer it without a body. */
export async function HEAD() {
  const response = await GET();
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}
