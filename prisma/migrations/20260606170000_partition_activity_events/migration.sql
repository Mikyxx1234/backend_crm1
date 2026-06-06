-- Fase 1 DW — particionamento mensal de `activity_events`.
--
-- POR QUÊ
--   `activity_events` é append-only e cresce linearmente com o tráfego
--   (cada mensagem WhatsApp, mudança de estágio, etc. = 1 linha). Sem
--   particionamento:
--     - autovacuum compete com as tabelas quentes (deals, messages);
--     - queries de DW (group by mês, percentis) varrem a tabela inteira;
--     - retenção via DELETE gera WAL/bloat e trava.
--   Convertendo em RANGE por mês:
--     - partition pruning: filtro por período toca só as partições do range;
--     - DROP de partição antiga é metadata-only (instantâneo, sem bloat);
--     - vacuum isolado por partição.
--
-- ESTRATÉGIA
--   Postgres exige que a chave de partição (occurredAt) faça parte de toda
--   constraint UNIQUE/PK → a PK passa a ser composta (id, occurredAt).
--   Como não dá pra converter uma tabela comum em particionada in-place,
--   recriamos: rename → cria particionada → copia dados → dropa legado.
--
-- IDEMPOTÊNCIA
--   Guarda via pg_partitioned_table: se já estiver particionada, não faz
--   nada. Seguro para reexecução.

-- ───────────────────────────────────────────────────────────────────────
-- 1) Conversão (guardada)
-- ───────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  is_part boolean;
  d date;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'activity_events'
  ) INTO is_part;

  IF is_part THEN
    RAISE NOTICE 'activity_events já é particionada — pulando conversão.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'activity_events') THEN
    RAISE NOTICE 'activity_events não existe — aplique a migration base antes.';
    RETURN;
  END IF;

  -- 1.1 Renomeia a tabela atual e libera nomes de constraints/índices
  ALTER TABLE "activity_events" RENAME TO "activity_events_legacy";

  ALTER TABLE "activity_events_legacy" DROP CONSTRAINT IF EXISTS "activity_events_pkey";
  ALTER TABLE "activity_events_legacy" DROP CONSTRAINT IF EXISTS "activity_events_organizationId_fkey";
  ALTER TABLE "activity_events_legacy" DROP CONSTRAINT IF EXISTS "activity_events_actorUserId_fkey";
  ALTER TABLE "activity_events_legacy" DROP CONSTRAINT IF EXISTS "activity_events_dealId_fkey";
  ALTER TABLE "activity_events_legacy" DROP CONSTRAINT IF EXISTS "activity_events_contactId_fkey";
  ALTER TABLE "activity_events_legacy" DROP CONSTRAINT IF EXISTS "activity_events_conversationId_fkey";

  DROP INDEX IF EXISTS "activity_events_org_occurredAt_idx";
  DROP INDEX IF EXISTS "activity_events_org_entity_occurredAt_idx";
  DROP INDEX IF EXISTS "activity_events_org_deal_occurredAt_idx";
  DROP INDEX IF EXISTS "activity_events_org_contact_occurredAt_idx";
  DROP INDEX IF EXISTS "activity_events_org_conv_occurredAt_idx";
  DROP INDEX IF EXISTS "activity_events_org_actorUser_occurredAt_idx";
  DROP INDEX IF EXISTS "activity_events_org_type_occurredAt_idx";
  DROP INDEX IF EXISTS "activity_events_org_actorType_occurredAt_idx";

  -- 1.2 Cria a tabela particionada (PK composta com a chave de partição)
  CREATE TABLE "activity_events" (
      "id"             TEXT              NOT NULL,
      "organizationId" TEXT              NOT NULL,
      "occurredAt"     TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "type"           TEXT              NOT NULL,
      "entityType"     "EventEntityType" NOT NULL,
      "entityId"       TEXT              NOT NULL,
      "entityLabel"    TEXT,
      "dealId"         TEXT,
      "contactId"      TEXT,
      "conversationId" TEXT,
      "actorType"      "ActorType"       NOT NULL,
      "actorUserId"    TEXT,
      "actorLabel"     TEXT,
      "actorSublabel"  TEXT,
      "actorRef"       TEXT,
      "field"          TEXT,
      "oldValue"       TEXT,
      "newValue"       TEXT,
      "meta"           JSONB             NOT NULL DEFAULT '{}'::jsonb,
      CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id", "occurredAt")
  ) PARTITION BY RANGE ("occurredAt");

  -- 1.3 Índices no pai (propagam como índices locais nas partições)
  CREATE INDEX "activity_events_org_occurredAt_idx"
      ON "activity_events"("organizationId", "occurredAt" DESC);
  CREATE INDEX "activity_events_org_entity_occurredAt_idx"
      ON "activity_events"("organizationId", "entityType", "entityId", "occurredAt" DESC);
  CREATE INDEX "activity_events_org_deal_occurredAt_idx"
      ON "activity_events"("organizationId", "dealId", "occurredAt" DESC);
  CREATE INDEX "activity_events_org_contact_occurredAt_idx"
      ON "activity_events"("organizationId", "contactId", "occurredAt" DESC);
  CREATE INDEX "activity_events_org_conv_occurredAt_idx"
      ON "activity_events"("organizationId", "conversationId", "occurredAt" DESC);
  CREATE INDEX "activity_events_org_actorUser_occurredAt_idx"
      ON "activity_events"("organizationId", "actorUserId", "occurredAt" DESC);
  CREATE INDEX "activity_events_org_type_occurredAt_idx"
      ON "activity_events"("organizationId", "type", "occurredAt" DESC);
  CREATE INDEX "activity_events_org_actorType_occurredAt_idx"
      ON "activity_events"("organizationId", "actorType", "occurredAt" DESC);

  -- 1.4 FKs no pai (FK SAINDO de tabela particionada é suportado em PG11+)
  ALTER TABLE "activity_events"
    ADD CONSTRAINT "activity_events_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "activity_events"
    ADD CONSTRAINT "activity_events_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "activity_events"
    ADD CONSTRAINT "activity_events_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "deals"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "activity_events"
    ADD CONSTRAINT "activity_events_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contacts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "activity_events"
    ADD CONSTRAINT "activity_events_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

  -- 1.5 Partições mensais (jan/2025 .. dez/2028). DEFAULT é a rede de
  --     segurança — inserts fora do range nunca falham.
  FOR d IN
    SELECT generate_series('2025-01-01'::date, '2028-12-01'::date, '1 month')::date
  LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "activity_events" FOR VALUES FROM (%L) TO (%L)',
      'activity_events_' || to_char(d, 'YYYY_MM'),
      d,
      (d + interval '1 month')::date
    );
  END LOOP;

  EXECUTE 'CREATE TABLE IF NOT EXISTS "activity_events_default" PARTITION OF "activity_events" DEFAULT';

  -- 1.6 Copia os dados existentes (tabela nova → volume baixo)
  INSERT INTO "activity_events" SELECT * FROM "activity_events_legacy";

  -- 1.7 Remove o legado (dropa também seus índices/constraints remanescentes)
  DROP TABLE "activity_events_legacy";

  RAISE NOTICE 'activity_events convertida em tabela particionada por mês.';
END$$;

-- ───────────────────────────────────────────────────────────────────────
-- 2) Função de manutenção: garante a partição de um mês (idempotente)
--    Chamada por cron mensal (ver scripts/activity-events-partitions.ts)
--    para criar a partição do mês seguinte com antecedência.
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION logs_ensure_activity_events_partition(p_month date)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  start_d date := date_trunc('month', p_month)::date;
  end_d   date := (date_trunc('month', p_month) + interval '1 month')::date;
  part    text := 'activity_events_' || to_char(start_d, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF "activity_events" FOR VALUES FROM (%L) TO (%L)',
    part, start_d, end_d
  );
END$$;

-- ───────────────────────────────────────────────────────────────────────
-- 3) Função de retenção: dropa partições mensais anteriores ao corte.
--    DROP de partição é metadata-only — instantâneo, sem WAL bloat.
--    Retorna a quantidade de partições removidas.
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION logs_drop_old_activity_events_partitions(p_retention_months int)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  cutoff  date := (date_trunc('month', now()) - make_interval(months => p_retention_months))::date;
  r       record;
  dropped int := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS name
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'activity_events'
      AND c.relname ~ '^activity_events_[0-9]{4}_[0-9]{2}$'
  LOOP
    IF to_date(right(r.name, 7), 'YYYY_MM') < cutoff THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', r.name);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END$$;
