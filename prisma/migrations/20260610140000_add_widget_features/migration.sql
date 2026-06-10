-- Adiciona coluna `features` em widgets (lista curta de bullets do card).
-- Backfill dos widgets internos para casar com o catalogo historico
-- (mesmas features que antes viviam em `src/lib/widget-catalog.ts`).

ALTER TABLE "widgets"
  ADD COLUMN IF NOT EXISTS "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "widgets"
SET "features" = ARRAY[
  'Distribuição automática de leads',
  'Regras por consultor, fila ou time',
  'Priorização inteligente',
  'Equilíbrio operacional'
]::TEXT[]
WHERE "slug" = 'smart_distribution' AND COALESCE(array_length("features", 1), 0) = 0;

UPDATE "widgets"
SET "features" = ARRAY[
  'Agentes de atendimento',
  'Qualificação automática',
  'Respostas inteligentes',
  'Integração com fluxos e automações'
]::TEXT[]
WHERE "slug" = 'ai_agents' AND COALESCE(array_length("features", 1), 0) = 0;
