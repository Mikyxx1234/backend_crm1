-- Alertas globais de Activity (pré-aviso 15min + vencimento) por usuário.

DO $$ BEGIN
  CREATE TYPE "ActivityAlertSnoozeKind" AS ENUM ('PRE_DUE', 'DUE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "activity_alert_states" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "preDueShownAt" TIMESTAMP(3),
    "dueShownAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "snoozedKind" "ActivityAlertSnoozeKind",
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_alert_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "activity_alert_states_activityId_userId_key"
  ON "activity_alert_states"("activityId", "userId");

CREATE INDEX IF NOT EXISTS "activity_alert_states_organizationId_userId_idx"
  ON "activity_alert_states"("organizationId", "userId");

CREATE INDEX IF NOT EXISTS "activity_alert_states_activityId_idx"
  ON "activity_alert_states"("activityId");

DO $$ BEGIN
  ALTER TABLE "activity_alert_states"
    ADD CONSTRAINT "activity_alert_states_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "activity_alert_states"
    ADD CONSTRAINT "activity_alert_states_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "activities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "activity_alert_states"
    ADD CONSTRAINT "activity_alert_states_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
