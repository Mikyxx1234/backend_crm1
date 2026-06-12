-- Channel → Pipeline routing (roteamento de inbound por canal).
--
-- SQL escrito de forma IDEMPOTENTE de propósito: o histórico de migrações
-- deste ambiente está divergente entre branches, então guardamos cada passo
-- com IF NOT EXISTS / checagem de constraint para que `migrate deploy` seja
-- seguro mesmo se a coluna já tiver sido aplicada manualmente no dev.

-- AlterTable
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "defaultPipelineId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "channels_defaultPipelineId_idx" ON "channels"("defaultPipelineId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'channels_defaultPipelineId_fkey'
  ) THEN
    ALTER TABLE "channels"
      ADD CONSTRAINT "channels_defaultPipelineId_fkey"
      FOREIGN KEY ("defaultPipelineId") REFERENCES "pipelines"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
