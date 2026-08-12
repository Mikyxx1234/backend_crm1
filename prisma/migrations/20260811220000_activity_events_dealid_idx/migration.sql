-- Fix "demora gigante" ao excluir deals: o ON DELETE CASCADE de
-- activity_events."dealId" (tabela particionada por mês; partições quentes
-- com ~3,3M rows em 2026_07/2026_08) não tinha índice no lado filho, então
-- CADA delete de deal fazia seq scan em todas as partições. Bulk delete de
-- N deals = N × 3,3M rows varridas. Índice no pai propaga para todas as
-- partições existentes e futuras.
-- Em prod o índice já foi criado manualmente (IF NOT EXISTS → no-op aqui).
CREATE INDEX IF NOT EXISTS "activity_events_dealId_idx" ON "activity_events" ("dealId");

-- Mesmo problema (SET NULL) — tabela vazia hoje, mas o índice é gratuito.
CREATE INDEX IF NOT EXISTS "calls_deal_id_idx" ON "calls" ("deal_id");
