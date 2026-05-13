-- CreateTable
CREATE TABLE "whatsapp_template_configs" (
    "id" TEXT NOT NULL,
    "meta_template_id" TEXT NOT NULL,
    "meta_template_name" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "agent_enabled" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'pt_BR',
    "category" TEXT,
    "body_preview" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_template_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_template_configs_meta_template_id_key" ON "whatsapp_template_configs"("meta_template_id");

-- CreateIndex
CREATE INDEX "whatsapp_template_configs_agent_enabled_idx" ON "whatsapp_template_configs"("agent_enabled");
