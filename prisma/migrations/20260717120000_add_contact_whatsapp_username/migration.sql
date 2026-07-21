-- Migration: add whatsapp_username to contacts (@ do WhatsApp — contacts[].profile.username no webhook Meta)
ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "whatsapp_username" TEXT;
