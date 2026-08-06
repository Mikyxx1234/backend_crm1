ALTER TABLE "course_configs" ADD COLUMN IF NOT EXISTS "channel" TEXT;
ALTER TABLE "course_configs" ADD COLUMN IF NOT EXISTS "discountPercent" DECIMAL(5,2);
