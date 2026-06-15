-- AlterTable: adicionar short_id ao whatsapp_flow_definitions
-- Nullable para compatibilidade com registros legados (sem short_id).
-- Novos registros recebem short_id gerado na aplicação (8 chars base64url).
ALTER TABLE "whatsapp_flow_definitions" ADD COLUMN "short_id" TEXT;

-- Índice único (permite NULL, pois registros legados ficam sem short_id)
CREATE UNIQUE INDEX "whatsapp_flow_definitions_short_id_key" ON "whatsapp_flow_definitions"("short_id");
