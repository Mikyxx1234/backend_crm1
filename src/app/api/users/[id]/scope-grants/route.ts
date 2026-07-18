/**
 * GET/PUT /api/users/[id]/scope-grants
 *
 * Escopo por usuário (funis e canais) sobre o `ScopeGrants` da org
 * (`permissions.scope.grants.v1`). Faz read-merge-write server-side para
 * NUNCA apagar regras de outros usuários/papéis ao salvar.
 *
 * Semântica dos campos:
 *   - `null`           → sem restrição (acesso a todos); remove a chave do user
 *   - `string[]`       → restringe aos IDs (vazio = nenhum; `["*"]` = todos)
 *   - omitido (PUT)    → não altera aquele campo
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

    const { id: userId } = await ctx.params;
    const grants = await getScopeGrants();

    const pipelineIds = grants.pipeline?.users?.[userId] ?? null;
    const channelViewIds = grants.channel?.view?.users?.[userId] ?? null;
    const channelSendIds = grants.channel?.send?.users?.[userId] ?? null;
    const channelInitiateIds = grants.channel?.initiate?.users?.[userId] ?? null;
    const channelManageIds = grants.channel?.manage?.users?.[userId] ?? null;
    const channelDenyIds = grants.channel?.deny?.users?.[userId] ?? null;

    return NextResponse.json({
      pipelineIds,
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

    const { id: userId } = await ctx.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const pipelineIds = parseField(body, "pipelineIds");
    const channelViewIds = parseField(body, "channelViewIds");
    const channelSendIds = parseField(body, "channelSendIds");
    const channelInitiateIds = parseField(body, "channelInitiateIds");
    const channelManageIds = parseField(body, "channelManageIds");
    const channelDenyIds = parseField(body, "channelDenyIds");

    // Read-merge-write: preserva TODAS as outras chaves dos grants (outros
    // usuários, roles e eixos não mexidos por esta requisição).
    const grants = await getScopeGrants();
    const next: ScopeGrants = {
      ...grants,
      pipeline: {
        ...grants.pipeline,
        users: { ...(grants.pipeline?.users ?? {}) },
      },
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
        delete target[userId];
      } else {
        target[userId] = value;
      }
    };

    applyField(next.pipeline!.users!, pipelineIds);
    applyField(next.channel!.view!.users!, channelViewIds);
    applyField(next.channel!.send!.users!, channelSendIds);
    applyField(next.channel!.initiate!.users!, channelInitiateIds);
    applyField(next.channel!.manage!.users!, channelManageIds);
    applyField(next.channel!.deny!.users!, channelDenyIds);

    await setScopeGrants(next);

    const saved = await getScopeGrants();
    const after = {
      pipelineIds: saved.pipeline?.users?.[userId] ?? null,
      channelViewIds: saved.channel?.view?.users?.[userId] ?? null,
      channelSendIds: saved.channel?.send?.users?.[userId] ?? null,
      channelInitiateIds: saved.channel?.initiate?.users?.[userId] ?? null,
      channelManageIds: saved.channel?.manage?.users?.[userId] ?? null,
      channelDenyIds: saved.channel?.deny?.users?.[userId] ?? null,
    };

    // Bloco E (25/jun/26): auditoria de mudanças de grants. Snapshot
    // antes/depois pro reviewer entender exatamente o que mudou.
    logAuditAsync({
      entity: "settings",
      action: "permission.scope.update",
      entityId: userId,
      before: {
        pipelineIds: grants.pipeline?.users?.[userId] ?? null,
        channelViewIds: grants.channel?.view?.users?.[userId] ?? null,
        channelSendIds: grants.channel?.send?.users?.[userId] ?? null,
        channelInitiateIds: grants.channel?.initiate?.users?.[userId] ?? null,
        channelManageIds: grants.channel?.manage?.users?.[userId] ?? null,
        channelDenyIds: grants.channel?.deny?.users?.[userId] ?? null,
      },
      after,
      metadata: { target: "user", targetId: userId },
    });

    return NextResponse.json({ ok: true, ...after });
  });
}
