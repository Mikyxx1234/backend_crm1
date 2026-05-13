-- Blinda contra reentrega/race do webhook Meta: dois processos paralelos
-- não conseguem mais gravar dois registros de troca de número com o mesmo
-- `wamid` da mensagem origem. A segunda transação falha com violação de
-- unicidade e o handler trata como duplicata silenciosa.
--
-- Antes do índice é preciso eliminar duplicatas históricas (se houver)
-- — mantemos sempre o registro mais antigo (menor `created_at`) por wamid.

DELETE FROM "contact_phone_changes" a
USING "contact_phone_changes" b
WHERE
  a."message_external_id" IS NOT NULL
  AND a."message_external_id" = b."message_external_id"
  AND a."created_at" > b."created_at";

CREATE UNIQUE INDEX IF NOT EXISTS "contact_phone_changes_message_external_id_key"
  ON "contact_phone_changes" ("message_external_id");
