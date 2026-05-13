-- Marca explicita de "agente IA ja cumprimentou nesta atribuicao".
-- Necessaria pra corrigir o bug em que a saudacao so disparava UMA
-- vez na vida da conversa (qualquer resposta anterior bloqueava).
-- Reseta quando a conversa e reatribuida.

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "aiGreetedAt" TIMESTAMP(3);
