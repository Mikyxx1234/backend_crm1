-- Multi-anexo em modelos internos de mensagem: array de { url, mimeType?, name? }.
-- Índice 0 continua espelhado em mediaUrl/mediaType/mediaName (compat legado).
ALTER TABLE "message_templates" ADD COLUMN "attachments" JSONB;
