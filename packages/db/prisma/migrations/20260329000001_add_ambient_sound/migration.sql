-- CreateEnum
CREATE TYPE "AmbientSoundType" AS ENUM ('NONE', 'OFFICE', 'CAFE', 'RESTAURANT', 'CITY', 'PEOPLE_TALKING');

-- AlterTable
ALTER TABLE "agents" ADD COLUMN "ambient_sound_type" "AmbientSoundType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "agents" ADD COLUMN "ambient_sound_volume" DOUBLE PRECISION NOT NULL DEFAULT 0.04;
