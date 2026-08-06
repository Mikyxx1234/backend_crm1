-- AlterTable
ALTER TABLE "course_configs" ADD COLUMN IF NOT EXISTS "pricingOptions" JSONB NOT NULL DEFAULT '[]';
