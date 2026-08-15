-- Corrige name/category do widget Ligações (UTF-8 via hex, sem depender
-- do encoding do arquivo SQL no runner).

UPDATE "widgets"
SET
  "name" = convert_from(decode('4c696761c3a7c3b56573', 'hex'), 'UTF8'),
  "category" = convert_from(decode('436f6d756e696361c3a7c3a36f', 'hex'), 'UTF8'),
  "description" = 'Softphone SIP, historico de chamadas e discagem nos cards do pipeline.',
  "updatedAt" = NOW()
WHERE "slug" = 'calls_history';
