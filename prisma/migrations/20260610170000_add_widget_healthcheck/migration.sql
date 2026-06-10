-- Healthcheck do widget (rodado pelo portal antes de publicar ONLINE).
-- Tres colunas opcionais:
--   * healthcheckOk: ultimo resultado (TRUE/FALSE/NULL = nunca rodado)
--   * healthcheckAt: timestamp
--   * healthcheckMessage: diagnostico curto pro parceiro (ex.: "HTTP 500",
--     "X-Frame-Options: DENY", "Connection timeout")

ALTER TABLE "widgets"
  ADD COLUMN IF NOT EXISTS "healthcheckOk" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "healthcheckAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "healthcheckMessage" TEXT;
