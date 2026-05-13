-- Add profile fields to User (phone, signature, closingMessage).
-- Nullable — all existing users continue to work without data backfill.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signature" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "closingMessage" TEXT;
