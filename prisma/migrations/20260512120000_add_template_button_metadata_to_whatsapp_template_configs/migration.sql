-- AlterTable: metadados de botões/variáveis/Flow para decisão de rota /template na inbox.
ALTER TABLE "whatsapp_template_configs" ADD COLUMN "has_buttons" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "whatsapp_template_configs" ADD COLUMN "button_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "whatsapp_template_configs" ADD COLUMN "has_variables" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "whatsapp_template_configs" ADD COLUMN "flow_action" TEXT;
ALTER TABLE "whatsapp_template_configs" ADD COLUMN "flow_id" TEXT;
