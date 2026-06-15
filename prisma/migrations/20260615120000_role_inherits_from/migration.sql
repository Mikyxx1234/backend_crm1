-- Role.inheritsFrom (Fase RBAC v2 — Grupos custom herdam permissions de outro Role).
--
-- Motivacao: o schema declarava `inheritsFrom String?` em `Role` desde o
-- commit que introduziu grupos Kommo (DEV_BRANCH bb82b96), mas a migration
-- correspondente nunca foi gerada. Resultado: Prisma client estoura P2022
-- "The column roles.inheritsFrom does not exist" em qualquer query a
-- Role.findMany / role.findFirst, derrubando /api/roles,
-- /api/users/[id]/effective-permissions e toda a tela /settings/permissions.
--
-- Idempotente: usa IF NOT EXISTS, podendo rodar com seguranca em DBs que
-- ja foram corrigidos via hotfix manual.
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "inheritsFrom" TEXT;

CREATE INDEX IF NOT EXISTS "roles_inheritsFrom_idx"
  ON "roles" ("inheritsFrom");
