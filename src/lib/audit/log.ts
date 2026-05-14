import { prismaBase } from "@/lib/prisma-base";
import { getRequestContext } from "@/lib/request-context";
import { getLogger } from "@/lib/logger";

const logger = getLogger("audit.log");

import { redactValue } from "./redact";

/**
 * Logger central de eventos sensiveis (PR 4.2).
 *
 * Convencoes:
 *   - `entity` em snake_case curto: "user" | "channel" | "api_token" |
 *     "organization" | "data_export" | "data_erase" | "impersonation".
 *     Outras categorias sao livres mas devem aparecer na lista do
 *     comentario do model AuditLog.
 *   - `action` em snake_case verboso: "create" | "update" | "delete" |
 *     "role_change" | "mfa_enable" | "mfa_disable" | "login_success" |
 *     "login_fail" | "token_revoke" | "channel_connect" | etc.
 *   - `before` e `after` redactados ANTES de persistir (chaves
 *     sensiveis viram "[REDACTED]").
 *
 * Nao bloqueia o request: erros sao logados via Pino mas nao
 * propagados — bloquear update de canal porque audit log falhou e
 * pior que nao auditar essa instancia.
 *
 * @see docs/audit-log.md
 */

export type AuditEntity =
  | "user"
  | "channel"
  | "api_token"
  | "organization"
  | "data_export"
  | "data_erase"
  | "impersonation"
  | "ai_agent"
  | "automation"
  | "settings"
  | (string & {});

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "login_success"
  | "login_fail"
  | "mfa_enable"
  | "mfa_disable"
  | "mfa_backup_codes_regenerate"
  | "role_change"
  | "password_change"
  | "token_create"
  | "token_revoke"
  | "channel_connect"
  | "channel_disconnect"
  | "data_export_request"
  | "data_export_download"
  | "data_erase_request"
  | "data_erase_complete"
  | "impersonate_start"
  | "impersonate_end"
  | "invite_create"
  | "invite_accept"
  | "feature_flag_set"
  | "subscription_updated"
  | "subscription_canceled"
  | "payment_failed"
  | "payment_succeeded"
  | (string & {});

export interface AuditLogInput {
  entity: AuditEntity;
  action: AuditAction;
  /** PK do recurso afetado. Omitir pra eventos sem resource especifico. */
  entityId?: string | null;
  /** Override explicito do organizationId. Default = ctx do request. */
  organizationId?: string | null;
  /** Override explicito do actorId. Default = ctx do request (userId). */
  actorId?: string | null;
  /** Email do actor — populado quando temos session, NULL pra cron/worker. */
  actorEmail?: string | null;
  /** Snapshot ANTES (update/delete). Sera redactado. */
  before?: unknown;
  /** Snapshot DEPOIS (create/update). Sera redactado. */
  after?: unknown;
  /** Metadata livre: { reason, channel, requestId, traceId, ... }. */
  metadata?: Record<string, unknown>;
  /** IP do request — sem isso, vazio. */
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Persiste um evento de auditoria. Idempotente nao — cada call cria
 * uma row. Caller deve evitar chamar dentro de loop sem batch.
 *
 * Nunca lanca: erros ficam no logger Pino (warn).
 */
export async function logAudit(input: AuditLogInput): Promise<void> {
  const ctx = getRequestContext();
  const orgId =
    input.organizationId !== undefined
      ? input.organizationId
      : ctx?.organizationId ?? null;
  const actorId =
    input.actorId !== undefined ? input.actorId : ctx?.userId ?? null;
  const actorIsSuperAdmin = Boolean(ctx?.isSuperAdmin);

  const before = input.before === undefined ? null : redactValue(input.before);
  const after = input.after === undefined ? null : redactValue(input.after);
  const metadata =
    input.metadata === undefined
      ? null
      : (redactValue(input.metadata) as Record<string, unknown>);

  try {
    await prismaBase.auditLog.create({
      data: {
        organizationId: orgId,
        actorId: actorId,
        actorEmail: input.actorEmail ?? null,
        actorIsSuperAdmin,
        entity: input.entity,
        entityId: input.entityId ?? null,
        action: input.action,
        before: before === null ? undefined : (before as object),
        after: after === null ? undefined : (after as object),
        metadata: metadata === null ? undefined : (metadata as object),
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    logger.warn(
      {
        err,
        entity: input.entity,
        action: input.action,
        entityId: input.entityId,
      },
      "[audit] failed to persist log",
    );
  }
}

/**
 * Versao "fire-and-forget" — nao espera o write. Usar quando o
 * caller esta em hot-path e nao pode esperar I/O (ex.: webhook
 * inbound). O log AINDA pode falhar; chame so quando perder uma
 * entrada nao for catastrofico.
 */
export function logAuditAsync(input: AuditLogInput): void {
  void logAudit(input);
}
