-- Card Ligações: descrição curta + bullets no mesmo padrão da Distribuição.

UPDATE "widgets"
SET
  "description" = 'Softphone SIP, histórico de chamadas e discagem nos cards do pipeline.',
  "features" = ARRAY[
    'Softphone integrado (Api4Com / SIP)',
    'Histórico de chamadas',
    'Discagem nos cards do pipeline',
    'Gravações automáticas via webhook'
  ]::TEXT[],
  "updatedAt" = NOW()
WHERE "slug" = 'calls_history';
