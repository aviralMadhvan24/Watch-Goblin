-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "ShowType" AS ENUM ('ANIME', 'TV');

-- CreateEnum
CREATE TYPE "AiringStatus" AS ENUM ('UPCOMING', 'AIRING', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WatchStatus" AS ENUM ('PLAN_TO_WATCH', 'WATCHING', 'COMPLETED', 'ON_HOLD', 'DROPPED', 'REWATCHING');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'FOLLOWERS', 'PRIVATE');

-- CreateEnum
CREATE TYPE "CreditKind" AS ENUM ('STUDIO', 'NETWORK');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('SHOW_ADDED', 'STATUS_CHANGED', 'SHOW_COMPLETED', 'SEASON_COMPLETED', 'EPISODE_WATCHED', 'SHOW_RATED', 'REVIEW_POSTED', 'USER_FOLLOWED', 'ACHIEVEMENT_UNLOCKED', 'LEVEL_UP', 'STREAK_MILESTONE');

-- CreateEnum
CREATE TYPE "XpReason" AS ENUM ('EPISODE_WATCHED', 'SEASON_COMPLETED', 'SHOW_COMPLETED', 'REVIEW_POSTED', 'REVIEW_LIKED', 'DAILY_STREAK', 'ACHIEVEMENT_UNLOCKED', 'PROFILE_COMPLETED');

-- CreateEnum
CREATE TYPE "AchievementCategory" AS ENUM ('MILESTONE', 'BINGE', 'STREAK', 'ANIME', 'TV', 'SOCIAL', 'SPECIAL');

-- CreateEnum
CREATE TYPE "AchievementMetric" AS ENUM ('SHOWS_COMPLETED', 'ANIME_COMPLETED', 'TV_COMPLETED', 'EPISODES_WATCHED', 'SEASONS_COMPLETED', 'MINUTES_WATCHED', 'EPISODES_IN_ONE_DAY', 'CURRENT_STREAK', 'LONGEST_STREAK', 'REVIEWS_POSTED', 'REVIEW_LIKES_RECEIVED', 'FOLLOWERS', 'LEVEL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "bannedAt" TIMESTAMP(3),
    "banReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" VARCHAR(280),
    "avatarUrl" TEXT,
    "bannerUrl" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#8b5cf6',
    "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC',
    "activityVisibility" "Visibility" NOT NULL DEFAULT 'PUBLIC',
    "humorEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shows" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "ShowType" NOT NULL,
    "title" TEXT NOT NULL,
    "originalTitle" TEXT,
    "synopsis" TEXT,
    "posterUrl" TEXT,
    "backdropUrl" TEXT,
    "airingStatus" "AiringStatus" NOT NULL DEFAULT 'ENDED',
    "firstAirDate" TIMESTAMP(3),
    "lastAirDate" TIMESTAMP(3),
    "averageRuntimeMinutes" INTEGER NOT NULL DEFAULT 24,
    "totalSeasons" INTEGER NOT NULL DEFAULT 0,
    "totalEpisodes" INTEGER NOT NULL DEFAULT 0,
    "originalLanguage" TEXT NOT NULL DEFAULT 'en',
    "popularity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "externalRating" DOUBLE PRECISION,
    "ratingSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "sourceProvider" TEXT NOT NULL DEFAULT 'local',
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "overview" TEXT,
    "posterUrl" TEXT,
    "airDate" TIMESTAMP(3),
    "episodeCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "overview" TEXT,
    "stillUrl" TEXT,
    "airDate" TIMESTAMP(3),
    "runtimeMinutes" INTEGER,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genres" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "genres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "show_genres" (
    "showId" TEXT NOT NULL,
    "genreId" TEXT NOT NULL,

    CONSTRAINT "show_genres_pkey" PRIMARY KEY ("showId","genreId")
);

-- CreateTable
CREATE TABLE "credits" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CreditKind" NOT NULL,

    CONSTRAINT "credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "show_credits" (
    "showId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,

    CONSTRAINT "show_credits_pkey" PRIMARY KEY ("showId","creditId")
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "photoUrl" TEXT,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cast_members" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "character" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cast_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_shows" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "status" "WatchStatus" NOT NULL DEFAULT 'PLAN_TO_WATCH',
    "rating" DOUBLE PRECISION,
    "currentSeasonNumber" INTEGER NOT NULL DEFAULT 0,
    "currentEpisodeNumber" INTEGER NOT NULL DEFAULT 0,
    "episodesWatched" INTEGER NOT NULL DEFAULT 0,
    "seasonsCompleted" INTEGER NOT NULL DEFAULT 0,
    "minutesWatched" INTEGER NOT NULL DEFAULT 0,
    "rewatchCount" INTEGER NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastWatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_shows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_episodes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "watchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "watchedOn" DATE NOT NULL,

    CONSTRAINT "user_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_watch_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "episodesWatched" INTEGER NOT NULL DEFAULT 0,
    "minutesWatched" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_watch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watch_streaks" (
    "userId" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "longest" INTEGER NOT NULL DEFAULT 0,
    "lastWatchDate" DATE,
    "startedOn" DATE,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watch_streaks_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "hasSpoilers" BOOLEAN NOT NULL DEFAULT false,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_likes" (
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_likes_pkey" PRIMARY KEY ("reviewId","userId")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follows" (
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("followerId","followingId")
);

-- CreateTable
CREATE TABLE "blocks" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC',
    "showId" TEXT,
    "reviewId" TEXT,
    "targetUserId" TEXT,
    "achievementId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranks" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '🍿',
    "minLevel" INTEGER NOT NULL,
    "minXp" INTEGER NOT NULL,
    "maxXp" INTEGER,
    "accentColor" TEXT NOT NULL DEFAULT '#8b5cf6',

    CONSTRAINT "ranks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "XpReason" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "category" "AchievementCategory" NOT NULL,
    "metric" "AchievementMetric" NOT NULL,
    "threshold" INTEGER NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valueAtUnlock" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("userId","achievementId")
);

-- CreateTable
CREATE TABLE "user_stats" (
    "userId" TEXT NOT NULL,
    "showsCompleted" INTEGER NOT NULL DEFAULT 0,
    "animeCompleted" INTEGER NOT NULL DEFAULT 0,
    "tvCompleted" INTEGER NOT NULL DEFAULT 0,
    "seasonsCompleted" INTEGER NOT NULL DEFAULT 0,
    "episodesWatched" INTEGER NOT NULL DEFAULT 0,
    "minutesWatched" INTEGER NOT NULL DEFAULT 0,
    "watching" INTEGER NOT NULL DEFAULT 0,
    "planToWatch" INTEGER NOT NULL DEFAULT 0,
    "onHold" INTEGER NOT NULL DEFAULT 0,
    "dropped" INTEGER NOT NULL DEFAULT 0,
    "rewatching" INTEGER NOT NULL DEFAULT 0,
    "reviewsPosted" INTEGER NOT NULL DEFAULT 0,
    "reviewLikesReceived" INTEGER NOT NULL DEFAULT 0,
    "followersCount" INTEGER NOT NULL DEFAULT 0,
    "followingCount" INTEGER NOT NULL DEFAULT 0,
    "xpTotal" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "rankId" TEXT,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_stats_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "user_favorite_shows" (
    "userId" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorite_shows_pkey" PRIMARY KEY ("userId","showId")
);

-- CreateTable
CREATE TABLE "user_favorite_genres" (
    "userId" TEXT NOT NULL,
    "genreId" TEXT NOT NULL,

    CONSTRAINT "user_favorite_genres_pkey" PRIMARY KEY ("userId","genreId")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "shows_slug_key" ON "shows"("slug");

-- CreateIndex
CREATE INDEX "shows_type_popularity_idx" ON "shows"("type", "popularity" DESC);

-- CreateIndex
CREATE INDEX "shows_type_firstAirDate_idx" ON "shows"("type", "firstAirDate" DESC);

-- CreateIndex
CREATE INDEX "shows_popularity_idx" ON "shows"("popularity" DESC);

-- CreateIndex
CREATE INDEX "shows_title_idx" ON "shows"("title");

-- CreateIndex
CREATE UNIQUE INDEX "shows_sourceProvider_sourceId_key" ON "shows"("sourceProvider", "sourceId");

-- CreateIndex
CREATE INDEX "seasons_showId_idx" ON "seasons"("showId");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_showId_number_key" ON "seasons"("showId", "number");

-- CreateIndex
CREATE INDEX "episodes_showId_seasonNumber_number_idx" ON "episodes"("showId", "seasonNumber", "number");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_seasonId_number_key" ON "episodes"("seasonId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "genres_slug_key" ON "genres"("slug");

-- CreateIndex
CREATE INDEX "show_genres_genreId_idx" ON "show_genres"("genreId");

-- CreateIndex
CREATE UNIQUE INDEX "credits_slug_key" ON "credits"("slug");

-- CreateIndex
CREATE INDEX "show_credits_creditId_idx" ON "show_credits"("creditId");

-- CreateIndex
CREATE UNIQUE INDEX "people_slug_key" ON "people"("slug");

-- CreateIndex
CREATE INDEX "cast_members_showId_order_idx" ON "cast_members"("showId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "cast_members_showId_personId_character_key" ON "cast_members"("showId", "personId", "character");

-- CreateIndex
CREATE INDEX "user_shows_userId_status_idx" ON "user_shows"("userId", "status");

-- CreateIndex
CREATE INDEX "user_shows_userId_lastWatchedAt_idx" ON "user_shows"("userId", "lastWatchedAt" DESC);

-- CreateIndex
CREATE INDEX "user_shows_userId_updatedAt_idx" ON "user_shows"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "user_shows_showId_status_idx" ON "user_shows"("showId", "status");

-- CreateIndex
CREATE INDEX "user_shows_showId_rating_idx" ON "user_shows"("showId", "rating");

-- CreateIndex
CREATE UNIQUE INDEX "user_shows_userId_showId_key" ON "user_shows"("userId", "showId");

-- CreateIndex
CREATE INDEX "user_episodes_userId_showId_idx" ON "user_episodes"("userId", "showId");

-- CreateIndex
CREATE INDEX "user_episodes_userId_watchedAt_idx" ON "user_episodes"("userId", "watchedAt" DESC);

-- CreateIndex
CREATE INDEX "user_episodes_userId_watchedOn_idx" ON "user_episodes"("userId", "watchedOn");

-- CreateIndex
CREATE INDEX "user_episodes_userId_seasonId_idx" ON "user_episodes"("userId", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "user_episodes_userId_episodeId_key" ON "user_episodes"("userId", "episodeId");

-- CreateIndex
CREATE INDEX "daily_watch_logs_userId_date_idx" ON "daily_watch_logs"("userId", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "daily_watch_logs_userId_date_key" ON "daily_watch_logs"("userId", "date");

-- CreateIndex
CREATE INDEX "reviews_showId_createdAt_idx" ON "reviews"("showId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "reviews_showId_likeCount_idx" ON "reviews"("showId", "likeCount" DESC);

-- CreateIndex
CREATE INDEX "reviews_userId_createdAt_idx" ON "reviews"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_userId_showId_key" ON "reviews"("userId", "showId");

-- CreateIndex
CREATE INDEX "review_likes_userId_idx" ON "review_likes"("userId");

-- CreateIndex
CREATE INDEX "comments_reviewId_createdAt_idx" ON "comments"("reviewId", "createdAt");

-- CreateIndex
CREATE INDEX "follows_followingId_createdAt_idx" ON "follows"("followingId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "follows_followerId_createdAt_idx" ON "follows"("followerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "blocks_blockedId_idx" ON "blocks"("blockedId");

-- CreateIndex
CREATE INDEX "activities_userId_createdAt_idx" ON "activities"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "activities_createdAt_idx" ON "activities"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "activities_showId_createdAt_idx" ON "activities"("showId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ranks_slug_key" ON "ranks"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ranks_minLevel_key" ON "ranks"("minLevel");

-- CreateIndex
CREATE INDEX "ranks_minLevel_idx" ON "ranks"("minLevel");

-- CreateIndex
CREATE INDEX "xp_events_userId_createdAt_idx" ON "xp_events"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "xp_events_userId_dedupeKey_key" ON "xp_events"("userId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_code_key" ON "achievements"("code");

-- CreateIndex
CREATE INDEX "achievements_category_sortOrder_idx" ON "achievements"("category", "sortOrder");

-- CreateIndex
CREATE INDEX "achievements_metric_idx" ON "achievements"("metric");

-- CreateIndex
CREATE INDEX "user_achievements_userId_unlockedAt_idx" ON "user_achievements"("userId", "unlockedAt" DESC);

-- CreateIndex
CREATE INDEX "user_achievements_achievementId_idx" ON "user_achievements"("achievementId");

-- CreateIndex
CREATE INDEX "user_stats_xpTotal_idx" ON "user_stats"("xpTotal" DESC);

-- CreateIndex
CREATE INDEX "user_stats_showsCompleted_idx" ON "user_stats"("showsCompleted" DESC);

-- CreateIndex
CREATE INDEX "user_stats_episodesWatched_idx" ON "user_stats"("episodesWatched" DESC);

-- CreateIndex
CREATE INDEX "user_stats_minutesWatched_idx" ON "user_stats"("minutesWatched" DESC);

-- CreateIndex
CREATE INDEX "user_stats_animeCompleted_idx" ON "user_stats"("animeCompleted" DESC);

-- CreateIndex
CREATE INDEX "user_stats_tvCompleted_idx" ON "user_stats"("tvCompleted" DESC);

-- CreateIndex
CREATE INDEX "user_stats_longestStreak_idx" ON "user_stats"("longestStreak" DESC);

-- CreateIndex
CREATE INDEX "user_stats_currentStreak_idx" ON "user_stats"("currentStreak" DESC);

-- CreateIndex
CREATE INDEX "user_favorite_shows_showId_idx" ON "user_favorite_shows"("showId");

-- CreateIndex
CREATE UNIQUE INDEX "user_favorite_shows_userId_slot_key" ON "user_favorite_shows"("userId", "slot");

-- CreateIndex
CREATE INDEX "user_favorite_genres_genreId_idx" ON "user_favorite_genres"("genreId");

-- CreateIndex
CREATE INDEX "admin_audit_logs_actorId_createdAt_idx" ON "admin_audit_logs"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_targetType_targetId_idx" ON "admin_audit_logs"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_genres" ADD CONSTRAINT "show_genres_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_genres" ADD CONSTRAINT "show_genres_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "genres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_credits" ADD CONSTRAINT "show_credits_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_credits" ADD CONSTRAINT "show_credits_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "credits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cast_members" ADD CONSTRAINT "cast_members_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cast_members" ADD CONSTRAINT "cast_members_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_shows" ADD CONSTRAINT "user_shows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_shows" ADD CONSTRAINT "user_shows_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_episodes" ADD CONSTRAINT "user_episodes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_episodes" ADD CONSTRAINT "user_episodes_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_episodes" ADD CONSTRAINT "user_episodes_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_episodes" ADD CONSTRAINT "user_episodes_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_watch_logs" ADD CONSTRAINT "daily_watch_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_streaks" ADD CONSTRAINT "watch_streaks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_likes" ADD CONSTRAINT "review_likes_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_likes" ADD CONSTRAINT "review_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "achievements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_rankId_fkey" FOREIGN KEY ("rankId") REFERENCES "ranks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorite_shows" ADD CONSTRAINT "user_favorite_shows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorite_shows" ADD CONSTRAINT "user_favorite_shows_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorite_genres" ADD CONSTRAINT "user_favorite_genres_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorite_genres" ADD CONSTRAINT "user_favorite_genres_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "genres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
