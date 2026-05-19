-- Opções para campos de seleção (Dropdown, Radio, Checkbox) no editor de WhatsApp Flow
ALTER TABLE "whatsapp_flow_fields" ADD COLUMN IF NOT EXISTS "options" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
