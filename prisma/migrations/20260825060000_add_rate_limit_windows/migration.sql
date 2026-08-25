-- Shared rate-limit windows, for RATE_LIMIT_DRIVER=postgres.
CREATE TABLE "rate_limit_windows" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_windows_pkey" PRIMARY KEY ("key")
);

-- Supports the periodic sweep of expired windows.
CREATE INDEX "rate_limit_windows_resetAt_idx" ON "rate_limit_windows"("resetAt");
