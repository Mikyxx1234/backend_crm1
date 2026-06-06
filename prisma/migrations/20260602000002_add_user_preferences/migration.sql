-- Preferencias pessoais por usuario (NAO tenant-scoped; chave = userId).
-- Espelha o padrao de user_mfa_backup_codes: tabela ligada a "users",
-- sem organizationId e sem RLS por organizacao. O isolamento e por userId
-- na camada de aplicacao (sempre session.user.id).
-- migration-safety: ignore (criacao de tabela nova; tudo idempotente).

CREATE TABLE "user_preferences" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  "sidebar"   JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_preferences_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_preferences_userId_key"
  ON "user_preferences" ("userId");
