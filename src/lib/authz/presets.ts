/**
 * Defaults dos 3 presets de Role (ADMIN/MANAGER/MEMBER).
 *
 * IMPORTANTE: este arquivo e a fonte da verdade pra TS — o seed SQL na
 * migration 20260601000000_authz_foundation/migration.sql replica
 * literalmente esses arrays. Se voce alterar permissions de um preset
 * aqui, EDITE TAMBEM o SQL e crie uma migration de update se a alteracao
 * precisar refletir em orgs ja existentes.
 *
 * Por que duas fontes? Porque o seed inicial roda no Postgres direto
 * (sem app rodando), e o reset/recriacao de presets via UI roda no app
 * (e usa esses arrays). Mantemos sincronizados manualmente — preco da
 * simplicidade.
 *
 * Comportamento desejado: ZERO quebra na transicao da Fase 1. Os
 * presets espelham o que cada role conseguia fazer ANTES (ADMIN=tudo,
 * MANAGER=gestao, MEMBER=operacional basico). Editar valores so apos
 * Fase 2 (quando a UI permitir customizacao por org).
 */

import type { UserRole } from "@prisma/client";

export const ADMIN_PERMISSIONS: readonly string[] = ["*"];

export const MANAGER_PERMISSIONS: readonly string[] = [
  // Pipeline
  "pipeline:view", "pipeline:create", "pipeline:edit", "pipeline:delete", "pipeline:manage_stages",
  // Contact
  "contact:view", "contact:create", "contact:edit", "contact:delete",
  "contact:export", "contact:import", "contact:merge", "contact:bulk_edit",
  // Company
  "company:view", "company:create", "company:edit", "company:delete",
  // Deal
  "deal:view", "deal:create", "deal:edit", "deal:delete",
  "deal:transfer_owner", "deal:change_stage", "deal:set_won", "deal:set_lost",
  // Conversation
  "conversation:view", "conversation:claim", "conversation:reassign_others",
  "conversation:resolve", "conversation:send_template", "conversation:transfer_channel",
  // Automation / AI
  "automation:view", "automation:create", "automation:edit", "automation:publish", "automation:delete",
  "ai_agent:view", "ai_agent:create", "ai_agent:edit", "ai_agent:delete",
  // Distribution (módulo smart_distribution)
  "distribution:view", "distribution:manage", "distribution:execute",
  // Campaign
  "campaign:view", "campaign:create", "campaign:edit", "campaign:send", "campaign:cancel",
  // Reports
  "report:view", "report:export",
  // Settings (subset — billing/api_tokens ficam com ADMIN)
  "settings:team", "settings:branding", "settings:channels",
  "settings:custom_fields", "settings:integrations",
  // Tag / Segment / Product
  "tag:view", "tag:create", "tag:edit", "tag:delete",
  "segment:view", "segment:create", "segment:edit", "segment:delete",
  "product:view", "product:create", "product:edit", "product:delete",
  // Channel / Template
  "channel:view", "channel:edit",
  "template:view", "template:create", "template:edit",
  // Tasks
  "task:view", "task:create", "task:edit", "task:delete", "task:complete_others",

  // ── Permissions v2 (Sprint 1) — extensão ──
  // Deals
  "deal:import", "deal:export", "deal:view_all",
  // Conversas (escopo + ações novas)
  "conversation:view_all", "conversation:view_unassigned",
  "conversation:assign", "conversation:reassign",
  "conversation:close", "conversation:reopen",
  "conversation:transfer", "conversation:send_template",
  "conversation:send_media", "conversation:view_internal_notes",
  // Canais específicos
  "channel:whatsapp", "channel:instagram", "channel:email",
  // Pipeline (kanban)
  "pipeline:view_cards_all", "pipeline:move_cards",
  // Contatos (escopo)
  "contact:view_all",
  // Empresas
  "company:export",
  // Relatórios (escopo)
  "report:view_team", "report:view_all",
  // Configurações (atalhos)
  "settings:view", "settings:pipelines", "settings:import_export",
  // Grupos
  "group:view", "group:manage",
  // Catálogo
  "product:import", "product:export",
  "price_table:view", "price_table:manage",
  "contract:view_all", "contract:manage",
  "discount:approve",
  // Dados sensíveis
  "data:view_phone", "data:view_email",
];

export const MEMBER_PERMISSIONS: readonly string[] = [
  "pipeline:view",
  "contact:view", "contact:create", "contact:edit",
  "company:view",
  "deal:view", "deal:create", "deal:edit", "deal:change_stage",
  "conversation:view", "conversation:claim", "conversation:resolve",
  "tag:view",
  "task:view", "task:create", "task:edit",
  "report:view",
  // Distribution: operador só visualiza (e altera o próprio online/offline,
  // controlado fora do RBAC via ownership na rota de status do agente).
  "distribution:view",

  // ── Permissions v2 (Sprint 1) — extensão ──
  // Deals (apenas próprios)
  "deal:view_own",
  // Conversas (próprias + sem responsável)
  "conversation:view_own", "conversation:view_unassigned",
  "conversation:assign", "conversation:close",
  "conversation:send_template", "conversation:send_media",
  // Canais
  "channel:whatsapp",
  // Pipeline (apenas próprios)
  "pipeline:view_cards_own", "pipeline:move_cards",
  // Contatos (apenas próprios)
  "contact:view_own",
  // Configurações (atalho de visualização)
  "settings:view",
  // Catálogo
  "product:view",
  "price_table:view",
  "contract:view_own",
  "discount:request",
  // Dados sensíveis
  "data:view_phone", "data:view_email",
];

export const PRESET_PERMISSIONS: Record<UserRole, readonly string[]> = {
  ADMIN: ADMIN_PERMISSIONS,
  MANAGER: MANAGER_PERMISSIONS,
  MEMBER: MEMBER_PERMISSIONS,
} as const;

export const PRESET_LABEL: Record<UserRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gestor",
  MEMBER: "Operador",
};

export const PRESET_DESCRIPTION: Record<UserRole, string> = {
  ADMIN: "Acesso total à organização. Não removível.",
  MANAGER: "Pode gerenciar equipe, funis, automações e relatórios.",
  MEMBER: "Atende leads, gerencia próprios negócios e tarefas.",
};
