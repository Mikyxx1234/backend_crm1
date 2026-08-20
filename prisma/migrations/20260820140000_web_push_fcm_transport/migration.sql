-- Transporte FCM nativo no APK, coexistindo com Web Push (VAPID).
-- Tokens FCM usam endpoint sintetico "fcm:<token>" (unique ja existente).

ALTER TABLE "web_push_subscriptions"
  ADD COLUMN IF NOT EXISTS "transport" TEXT NOT NULL DEFAULT 'WEB';

ALTER TABLE "web_push_subscriptions"
  ADD COLUMN IF NOT EXISTS "platform" TEXT;

CREATE INDEX IF NOT EXISTS "web_push_subscriptions_userId_transport_idx"
  ON "web_push_subscriptions"("userId", "transport");
