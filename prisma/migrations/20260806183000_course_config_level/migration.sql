-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CourseLevel" AS ENUM ('GRADUATION', 'POSTGRADUATE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "course_configs" ADD COLUMN IF NOT EXISTS "level" "CourseLevel";
