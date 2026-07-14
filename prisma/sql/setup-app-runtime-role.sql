-- Setup do role `app_runtime` para runtime da aplicacao sem BYPASSRLS.
--
-- CONTEXTO
-- --------
-- Hoje a aplicacao conecta no Postgres via um role que e OWNER das
-- tabelas (ex.: o role criado para rodar `prisma migrate deploy`).
-- Owners no Postgres sao IMUNES a policies RLS por padrao, mesmo com
-- `FORCE ROW LEVEL SECURITY` — o `FORCE` so obriga o owner a passar
-- pelas policies quando ele NAO tem BYPASSRLS. Roles superusuarios
-- e roles com BYPASSRLS (default de novos superuser-like) tambem
-- ignoram policies.
--
-- Portanto, ativar RLS sozinho NAO isola os tenants na pratica: os
-- inserts/selects continuam vindo do owner e as policies sao no-op.
-- Precisamos criar um role NAO-owner, sem BYPASSRLS, com apenas os
-- privilegios data-modification, e apontar a DATABASE_URL da aplicacao
-- para ele. As migrations continuam rodando com o owner separado.
--
-- COMO USAR
-- ---------
-- Execute este arquivo como SUPERUSUARIO (postgres) uma vez apos ter
-- os `RLS_PROTECTED_TABLES` criados no schema:
--
--   psql "$SUPERUSER_URL" -f prisma/sql/setup-app-runtime-role.sql
--
-- Depois configure duas connection strings:
--   DATABASE_URL          -> app_runtime  (usada pela app em runtime)
--   MIGRATE_DATABASE_URL  -> owner atual  (usada em CI/migrate deploy)
--
-- ATENCAO: nao rode em producao sem antes ter passado o
-- `npm run test:isolation` em staging com este mesmo setup.

-- 1. Cria o role sem login-power extra. NOSUPERUSER + NOBYPASSRLS
--    sao os defaults novos do Postgres, mas explicitamos para o caso
--    de bases antigas onde CREATEROLE herda BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    -- Troque a senha antes de rodar em prod real.
    CREATE ROLE app_runtime LOGIN PASSWORD 'REPLACE_ME_STRONG_PASSWORD'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    -- Reafirma que nao tem BYPASSRLS mesmo que o role ja exista.
    ALTER ROLE app_runtime NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- 2. Conexao ao banco corrente + acesso ao schema public.
GRANT CONNECT ON DATABASE current_database() TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;

-- 3. Privilegios de DML em tudo que ja existe. Prisma cria/altera
--    tabelas com o role owner das migrations, entao precisamos
--    tambem garantir default privileges para tabelas futuras.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO app_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  TO app_runtime;

-- 4. Default privileges para futuras tabelas/sequences criadas pelo
--    role de migration (substitua `<MIGRATION_ROLE>` pelo role que
--    voce usa em `prisma migrate deploy`, ex.: `crm_owner`).
--
-- ALTER DEFAULT PRIVILEGES FOR ROLE <MIGRATION_ROLE> IN SCHEMA public
--   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
-- ALTER DEFAULT PRIVILEGES FOR ROLE <MIGRATION_ROLE> IN SCHEMA public
--   GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
-- ALTER DEFAULT PRIVILEGES FOR ROLE <MIGRATION_ROLE> IN SCHEMA public
--   GRANT EXECUTE ON FUNCTIONS TO app_runtime;

-- 5. NAO conceder ao app_runtime a capacidade de alterar policies:
--    nao dar CREATE no schema public e nao dar owner de tabela.
--    (Ja garantido pelo GRANT USAGE em vez de CREATE.)

-- 6. Confirma o estado do role (executar apos criar):
--
--   SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
--     FROM pg_roles WHERE rolname = 'app_runtime';
--
-- Deve retornar rolsuper=false, rolbypassrls=false, rolcanlogin=true.
