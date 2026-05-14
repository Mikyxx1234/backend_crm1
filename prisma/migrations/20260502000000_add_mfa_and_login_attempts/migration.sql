-- PR 4.1: MFA TOTP + Login Attempts (lockout exponencial)
--
-- Sem dados destrutivos. Todos os campos novos sao nullable ou tem
-- default seguro (booleans=false, listas=[]). Backfill nao necessario:
-- users existentes ficam com `mfaSecret=null` e `mfaEnabledAt=null`,
-- o que significa "MFA desabilitado pra esse user" — login passa
-- normalmente sem MFA. Habilitacao e opt-in via /settings/security.
--
-- Indices em LoginAttempt sao chave pro hot path do lockout
-- (`COUNT WHERE userId = X AND createdAt > now() - 15min`).

ALTER TABLE "users"
  ADD COLUMN "mfaSecret"    TEXT,
  ADD COLUMN "mfaEnabledAt" TIMESTAMP(3);

CREATE TABLE "user_mfa_backup_codes" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "codeHash"  TEXT         NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_mfa_backup_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_mfa_backup_codes_userId_idx"
    ON "user_mfa_backup_codes"("userId");

ALTER TABLE "user_mfa_backup_codes"
  ADD CONSTRAINT "user_mfa_backup_codes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "login_attempts" (
    "id"        TEXT         NOT NULL,
    "email"     TEXT         NOT NULL,
    "userId"    TEXT,
    "ip"        TEXT,
    "userAgent" TEXT,
    "outcome"   TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_attempts_email_createdAt_idx"
    ON "login_attempts"("email", "createdAt");
CREATE INDEX "login_attempts_userId_createdAt_idx"
    ON "login_attempts"("userId", "createdAt");
CREATE INDEX "login_attempts_createdAt_idx"
    ON "login_attempts"("createdAt");

ALTER TABLE "login_attempts"
  ADD CONSTRAINT "login_attempts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
