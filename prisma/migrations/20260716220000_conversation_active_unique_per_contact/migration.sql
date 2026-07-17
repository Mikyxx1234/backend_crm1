-- Garante NO MAXIMO UMA conversa ATIVA (status != RESOLVED) por
-- (organizationId, contactId, channel). Fecha a condicao de corrida em que
-- mensagens inbound simultaneas criavam multiplos tickets OPEN pro mesmo
-- numero (cards duplicados/triplicados na inbox).
--
-- O modelo de ticket permanece: conversas RESOLVED sao historico e podem
-- coexistir em qualquer quantidade — por isso o indice e' PARCIAL.

-- Passo 1 (defensivo/lossless): se ainda existirem tickets ativos duplicados
-- (ex.: o script merge-duplicate-conversations nao foi rodado antes), mantem
-- o mais ANTIGO ativo e encerra os demais como RESOLVED. Nao apaga nem move
-- mensagens — para uma consolidacao real (mesclando o historico num unico
-- ticket) rode `pnpm tsx src/scripts/merge-duplicate-conversations.ts --apply`
-- ANTES desta migration. Aqui e' apenas a rede de seguranca para o indice.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId", "contactId", "channel"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "conversations"
  WHERE "status" <> 'RESOLVED'
)
UPDATE "conversations" AS c
SET "status" = 'RESOLVED',
    "closedAt" = COALESCE(c."closedAt", NOW())
FROM ranked
WHERE c."id" = ranked."id"
  AND ranked.rn > 1;

-- Passo 2: indice unico parcial. Cobre apenas tickets ativos.
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_active_contact_channel"
ON "conversations" ("organizationId", "contactId", "channel")
WHERE "status" <> 'RESOLVED';
