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

    return NextResponse.json({ pipelineIds, channelViewIds, channelSendIds });
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

    // Read-merge-write: preserva todas as outras chaves dos grants.
    const grants = await getScopeGrants();
    const next: ScopeGrants = {
      ...grants,
      pipeline: {
        ...grants.pipeline,
        users: { ...(grants.pipeline?.users ?? {}) },
      },
      channel: {
        view: { users: { ...(grants.channel?.view?.users ?? {}) } },
        send: { users: { ...(grants.channel?.send?.users ?? {}) } },
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

    await setScopeGrants(next);

    const saved = await getScopeGrants();
    return NextResponse.json({
      ok: true,
      pipelineIds: saved.pipeline?.users?.[userId] ?? null,
      channelViewIds: saved.channel?.view?.users?.[userId] ?? null,
      channelSendIds: saved.channel?.send?.users?.[userId] ?? null,
    });
  });
}
