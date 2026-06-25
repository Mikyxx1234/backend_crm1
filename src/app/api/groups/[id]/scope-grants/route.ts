/**
 * GET/PUT /api/groups/[id]/scope-grants
 *
 * Escopo de CANAL por Grupo (group-based scoping, eixo aditivo introduzido
 * no Bloco A da Fase 1 de Gestão de Canais — 25/jun/26) sobre o
 * `ScopeGrants` da org (`permissions.scope.grants.v1`, chaves
 * `channel.{view,send,initiate,manage,deny}.groups[groupId]`).
 *
 * Faz read-merge-write server-side para NUNCA apagar regras de outros
 * grupos, papéis, usuários ou eixos ao salvar.
 *
 * Eixo ADITIVO: o usuário recebe acesso a um canal se QUALQUER regra
 * (override pessoal OU role OU grupo) permitir. Deny bloqueia (exceto
 * para quem tem `manage` no mesmo canal — anti-lockout). Ver
 * `canAccessChannelForUser` em `scope-grants-shared.ts`.
 *
 * Semântica dos campos (igual aos endpoints de user/role):
 *   - `null`        → sem restrição por este grupo (remove a chave do group)
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

    const { id: groupId } = await ctx.params;
    const grants = await getScopeGrants();

    const channelViewIds = grants.channel?.view?.groups?.[groupId] ?? null;
    const channelSendIds = grants.channel?.send?.groups?.[groupId] ?? null;
    const channelInitiateIds = grants.channel?.initiate?.groups?.[groupId] ?? null;
    const channelManageIds = grants.channel?.manage?.groups?.[groupId] ?? null;
    const channelDenyIds = grants.channel?.deny?.groups?.[groupId] ?? null;

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

    const { id: groupId } = await ctx.params;
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
    // grupos, roles, overrides por usuário e demais eixos).
    const grants = await getScopeGrants();
    const next: ScopeGrants = {
      ...grants,
      channel: {
        view: {
          users: { ...(grants.channel?.view?.users ?? {}) },
          roles: { ...(grants.channel?.view?.roles ?? {}) },
          groups: { ...(grants.channel?.view?.groups ?? {}) },
        },
        send: {
          users: { ...(grants.channel?.send?.users ?? {}) },
          roles: { ...(grants.channel?.send?.roles ?? {}) },
          groups: { ...(grants.channel?.send?.groups ?? {}) },
        },
        initiate: {
          users: { ...(grants.channel?.initiate?.users ?? {}) },
          roles: { ...(grants.channel?.initiate?.roles ?? {}) },
          groups: { ...(grants.channel?.initiate?.groups ?? {}) },
        },
        manage: {
          users: { ...(grants.channel?.manage?.users ?? {}) },
          roles: { ...(grants.channel?.manage?.roles ?? {}) },
          groups: { ...(grants.channel?.manage?.groups ?? {}) },
        },
        deny: {
          users: { ...(grants.channel?.deny?.users ?? {}) },
          roles: { ...(grants.channel?.deny?.roles ?? {}) },
          groups: { ...(grants.channel?.deny?.groups ?? {}) },
        },
      },
    };

    const applyField = (
      target: Record<string, string[] | undefined>,
      value: string[] | null | undefined,
    ) => {
      if (value === undefined) return;
      if (value === null) {
        delete target[groupId];
      } else {
        target[groupId] = value;
      }
    };

    applyField(next.channel!.view!.groups!, channelViewIds);
    applyField(next.channel!.send!.groups!, channelSendIds);
    applyField(next.channel!.initiate!.groups!, channelInitiateIds);
    applyField(next.channel!.manage!.groups!, channelManageIds);
    applyField(next.channel!.deny!.groups!, channelDenyIds);

    await setScopeGrants(next);

    const saved = await getScopeGrants();
    const after = {
      channelViewIds: saved.channel?.view?.groups?.[groupId] ?? null,
      channelSendIds: saved.channel?.send?.groups?.[groupId] ?? null,
      channelInitiateIds: saved.channel?.initiate?.groups?.[groupId] ?? null,
      channelManageIds: saved.channel?.manage?.groups?.[groupId] ?? null,
      channelDenyIds: saved.channel?.deny?.groups?.[groupId] ?? null,
    };

    // Bloco E (25/jun/26): auditoria de mudanças de grants por grupo.
    logAuditAsync({
      entity: "settings",
      action: "permission.scope.update",
      entityId: groupId,
      before: {
        channelViewIds: grants.channel?.view?.groups?.[groupId] ?? null,
        channelSendIds: grants.channel?.send?.groups?.[groupId] ?? null,
        channelInitiateIds: grants.channel?.initiate?.groups?.[groupId] ?? null,
        channelManageIds: grants.channel?.manage?.groups?.[groupId] ?? null,
        channelDenyIds: grants.channel?.deny?.groups?.[groupId] ?? null,
      },
      after,
      metadata: { target: "group", targetId: groupId },
    });

    return NextResponse.json({ ok: true, ...after });
  });
}
