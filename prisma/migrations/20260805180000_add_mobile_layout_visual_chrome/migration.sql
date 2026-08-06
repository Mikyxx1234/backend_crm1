-- AlterTable
ALTER TABLE "mobile_layout_config" ADD COLUMN IF NOT EXISTS "visualChrome" BOOLEAN NOT NULL DEFAULT false;
