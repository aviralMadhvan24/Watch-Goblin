/*
  Warnings:

  - Added the required column `episodeNumber` to the `user_episodes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonNumber` to the `user_episodes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "user_episodes" ADD COLUMN     "episodeNumber" INTEGER NOT NULL,
ADD COLUMN     "seasonNumber" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "user_episodes_userId_showId_seasonNumber_episodeNumber_idx" ON "user_episodes"("userId", "showId", "seasonNumber", "episodeNumber");
