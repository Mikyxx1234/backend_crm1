-- Index para recovery de backlog do worker-meta-webhook:
-- busca de eventos não processados (processed=false) em ordem de chegada.
CREATE INDEX IF NOT EXISTS "meta_webhook_events_processed_receivedAt_idx"
  ON "meta_webhook_events" ("processed", "receivedAt");
