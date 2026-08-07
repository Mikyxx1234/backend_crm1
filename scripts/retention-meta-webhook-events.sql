-- Retenção conservadora de meta_webhook_events (dry-run + delete em lotes).
-- NÃO rode o DELETE em prod sem confirmação explícita.
--
-- Baseline prod (2026-08-07): ~1.9 GB / ~1.17M rows; oldest ~2026-05-21.
-- Janela sugerida: KEEP_DAYS = 60 (ou 90). Abaixo de 30d não recomendado.
--
-- activity_events já é particionado mensalmente — use o script TS existente:
--   pnpm tsx src/scripts/activity-events-partitions.ts --retention=2
-- (default do script é 24 meses; 2 = mês atual + anterior. Partição 2026_07
-- sozinha ~4 GB — dropar só com retenção consciente.)

-- Preview
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE "receivedAt" < now() - interval '60 days') AS older_60d,
  COUNT(*) FILTER (WHERE "receivedAt" < now() - interval '90 days') AS older_90d,
  MIN("receivedAt") AS oldest,
  MAX("receivedAt") AS newest,
  pg_size_pretty(pg_total_relation_size('meta_webhook_events')) AS total_size
FROM meta_webhook_events;

-- Delete em lotes (descomente após dry-run). Ajuste o intervalo.
-- BEGIN;
-- WITH doomed AS (
--   SELECT id FROM meta_webhook_events
--   WHERE "receivedAt" < now() - interval '60 days'
--   ORDER BY "receivedAt"
--   LIMIT 5000
--   FOR UPDATE SKIP LOCKED
-- )
-- DELETE FROM meta_webhook_events m
-- USING doomed d
-- WHERE m.id = d.id;
-- COMMIT;
-- Repita até older_60d = 0; depois VACUUM (ANALYZE) meta_webhook_events;
