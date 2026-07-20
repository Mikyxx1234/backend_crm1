/**
 * GET/PUT /api/roles/[id]/scope-grants
 *
 * Escopo de CANAL por Role (RBAC) sobre o `ScopeGrants` da org
 * (`permissions.scope.grants.v1`, chave `channel.{view,send}.roles[roleId]`).
 * Faz read-merge-write server-side para NUNCA apagar regras de outros papéis,
 * usuários ou eixos ao salvar.
 *
 * Eixo ADITIVO: o usuário vê/usa um canal se QUALQUER regra (override pessoal
 * OU uma de suas roles) permitir. Ver `canAccessChannelForUser`.
 *
 * Semântica dos campos (igual ao escopo por usuário):
 *   - `null`        → sem restrição por esta role (remove a chave da role)
 *   - `string[]`    → restringe/concede aos IDs (vazio = nenhum; `["*"]` = todos)
 *   - omitido (PUT) → não altera aquele campo
 */

import { NextResponse } from "next/server";

import { logAuditAsync } from "@/lib/audit/log";
import { withOrgContext, requireAuthWithCtx } from "@/lib/auth-helpers";
import { can } from "@/lib/authz";
import {
  getScopeGrants,
  setScopeGrants,
  type ScopeGrants,
} from "@/lib/authz/scope-grants";

type Ctx = { params: Promise<{ id: string }> };

function readList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

/** `undefined` = não enviado; `null` = remover (todos); `string[]` = definir. */
function parseField(
  body: Record<string, unknown>,
  key: string,
): string[] | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (Array.isArray(value)) return readList(value) ?? [];
  return undefined;
}

export async function GET(_req: Request, ctx: Ctx) {
  return withOrgContext(async () => {
    const authz = await requireAuthWithCtx();
    if (!authz.ok) return authz.response;
    if (!can(authz.ctx, "settings:permissions")) {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }

    const { id: roleId } = await ctx.params;
    const grants = await getScopeGrants();

    const channelViewIds = grants.channel?.view?.roles?.[roleId] ?? null;
    const channelSendIds = grants.channel?.send?.roles?.[roleId] ?? null;
    const channelInitiateIds = grants.channel?.initiate?.roles?.[roleId] ?? null;
    const channelManageIds = grants.channel?.manage?.roles?.[roleId] ?? null;
    const channelDenyIds = grants.channel?.deny?.roles?.[roleId] ?? null;

    return NextResponse.json({
      channelViewIds,
      channelSendIds,
      channelInitiateIds,
      channelManageIds,
      channelDenyIds,
    });
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  return withOrgContext(async () => {
    const authz = await requireAuthWithCtx();
    if (!authz.ok) return authz.response;
    if (!can(authz.ctx, "settings:permissions")) {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }

    const { id: roleId } = await ctx.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const channelViewIds = parseField(body, "channelViewIds");
    const channelSendIds = parseField(body, "channelSendIds");
    const channelInitiateIds = parseField(body, "channelInitiateIds");
    const channelManageIds = parseField(body, "channelManageIds");
    const channelDenyIds = parseField(body, "channelDenyIds");

    // Read-merge-write: preserva TODAS as outras chaves dos grants (outros
    // papéis, overrides por usuário e demais eixos).
    const grants = await getScopeGrants();
    const next: ScopeGrants = {
      ...grants,
      channel: {
        view: {
          users: { ...(grants.channel?.view?.users ?? {}) },
          roles: { ...(grants.channel?.view?.roles ?? {}) },
        },
        send: {
          users: { ...(grants.channel?.send?.users ?? {}) },
          roles: { ...(grants.channel?.send?.roles ?? {}) },
        },
        initiate: {
          users: { ...(grants.channel?.initiate?.users ?? {}) },
          roles: { ...(grants.channel?.initiate?.roles ?? {}) },
        },
        manage: {
          users: { ...(grants.channel?.manage?.users ?? {}) },
          roles: { ...(grants.channel?.manage?.roles ?? {}) },
        },
        deny: {
          users: { ...(grants.channel?.deny?.users ?? {}) },
          roles: { ...(grants.channel?.deny?.roles ?? {}) },
        },
      },
    };

    const applyField = (
      target: Record<string, string[] | undefined>,
      value: string[] | null | undefined,
    ) => {
      if (value === undefined) return;
      if (value === null) {
        delete target[roleId];
      } else {
        target[roleId] = value;
      }
    };

    applyField(next.channel!.view!.roles!, channelViewIds);
    applyField(next.channel!.send!.roles!, channelSendIds);
    applyField(next.channel!.initiate!.roles!, channelInitiateIds);
    applyField(next.channel!.manage!.roles!, channelManageIds);
    applyField(next.channel!.deny!.roles!, channelDenyIds);

    await setScopeGrants(next);

    const saved = await getScopeGrants();
    const after = {
      channelViewIds: saved.channel?.view?.roles?.[roleId] ?? null,
      channelSendIds: saved.channel?.send?.roles?.[roleId] ?? null,
      channelInitiateIds: saved.channel?.initiate?.roles?.[roleId] ?? null,
      channelManageIds: saved.channel?.manage?.roles?.[roleId] ?? null,
      channelDenyIds: saved.channel?.deny?.roles?.[roleId] ?? null,
    };

    // Bloco E (25/jun/26): auditoria de mudanças de grants por role.
    logAuditAsync({
      entity: "settings",
      action: "permission.scope.update",
      entityId: roleId,
      before: {
        channelViewIds: grants.channel?.view?.roles?.[roleId] ?? null,
        channelSendIds: grants.channel?.send?.roles?.[roleId] ?? null,
        channelInitiateIds: grants.channel?.initiate?.roles?.[roleId] ?? null,
        channelManageIds: grants.channel?.manage?.roles?.[roleId] ?? null,
        channelDenyIds: grants.channel?.deny?.roles?.[roleId] ?? null,
      },
      after,
      metadata: { target: "role", targetId: roleId },
    });

    return NextResponse.json({ ok: true, ...after });
  });
}
