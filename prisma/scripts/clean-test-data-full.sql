-- ─────────────────────────────────────────────────────────────────────────
-- CLEAN TEST DATA — FULL MODE
-- ─────────────────────────────────────────────────────────────────────────
-- Apaga todo o volume transacional/teste acumulado no CRM, preservando:
--   • usuários (users, api_tokens, agent_schedules, agent_statuses)
--   • canais configurados (channels, baileys_auth_keys)
--   • pipelines / stages
--   • catálogo (products, product_custom_field_values)
--   • tags (definições — as associações com contact/deal morrem junto)
--   • custom_fields (definições — os valores morrem junto)
--   • automations + automation_steps (definições — contexts/logs morrem)
--   • quick_replies, message_templates, whatsapp_template_configs
--   • distribution_rules + distribution_members
--   • loss_reasons
--   • system_settings
--   • segments (definições — campaign_recipients morrem juntos)
--
-- Apaga:
--   • messages, conversations
--   • whatsapp_call_events, scheduled_whatsapp_calls
--   • automation_contexts, automation_logs
--   • deal_events, deal_products, deal_custom_field_values, tags_on_deals
--   • tags_on_contacts, contact_custom_field_values
--   • notes, activities
--   • campaigns, campaign_recipients
--   • deals
--   • contacts, companies
--
-- Como rodar dentro do container do CRM (Easypanel terminal):
--
--     psql "$DATABASE_URL" -f /app/prisma/scripts/clean-test-data-full.sql
--
-- ou a partir do host, via docker:
--
--     docker exec -i <postgres-container> psql -U <user> -d <db> < clean-test-data-full.sql
--
-- O TRUNCATE ... CASCADE já respeita FKs, RESTART IDENTITY zera sequences
-- e a transação garante atomicidade (rollback automático se algo falhar).
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

TRUNCATE TABLE
  messages,
  whatsapp_call_events,
  scheduled_whatsapp_calls,
  automation_contexts,
  automation_logs,
  deal_events,
  deal_products,
  deal_custom_field_values,
  tags_on_deals,
  tags_on_contacts,
  contact_custom_field_values,
  notes,
  activities,
  campaign_recipients,
  campaigns,
  conversations,
  deals,
  contacts,
  companies
RESTART IDENTITY CASCADE;

-- Sanity check — retorna contagens das tabelas apagadas (tudo deve ser 0).
SELECT
  (SELECT COUNT(*) FROM messages)                    AS messages,
  (SELECT COUNT(*) FROM conversations)               AS conversations,
  (SELECT COUNT(*) FROM contacts)                    AS contacts,
  (SELECT COUNT(*) FROM deals)                       AS deals,
  (SELECT COUNT(*) FROM companies)                   AS companies,
  (SELECT COUNT(*) FROM activities)                  AS activities,
  (SELECT COUNT(*) FROM notes)                       AS notes,
  (SELECT COUNT(*) FROM whatsapp_call_events)        AS whatsapp_calls,
  (SELECT COUNT(*) FROM automation_contexts)         AS automation_ctx,
  (SELECT COUNT(*) FROM automation_logs)             AS automation_logs,
  (SELECT COUNT(*) FROM campaign_recipients)         AS campaign_recipients,
  (SELECT COUNT(*) FROM campaigns)                   AS campaigns;

-- Integridade preservada — deve mostrar os users/canais/pipelines etc.
SELECT
  (SELECT COUNT(*) FROM users)                       AS users_preserved,
  (SELECT COUNT(*) FROM channels)                    AS channels_preserved,
  (SELECT COUNT(*) FROM pipelines)                   AS pipelines_preserved,
  (SELECT COUNT(*) FROM stages)                      AS stages_preserved,
  (SELECT COUNT(*) FROM automations)                 AS automations_preserved,
  (SELECT COUNT(*) FROM products)                    AS products_preserved,
  (SELECT COUNT(*) FROM message_templates)           AS templates_preserved,
  (SELECT COUNT(*) FROM system_settings)             AS settings_preserved;

COMMIT;

-- Vacuum opcional logo após limpar grandes volumes (libera espaço físico
-- e atualiza estatísticas do planner). Roda fora da transação.
VACUUM (ANALYZE) messages, conversations, deals, contacts,
  whatsapp_call_events, automation_logs, campaign_recipients;
